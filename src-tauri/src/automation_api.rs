use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Emitter;
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot},
    time::{timeout, Duration},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

type Peers = Arc<tokio::sync::Mutex<HashMap<String, Peer>>>;

struct Peer {
    sender: mpsc::UnboundedSender<Message>,
    subscriptions: HashMap<String, Subscription>,
}

#[derive(Clone)]
struct Subscription {
    events: Vec<String>,
    filters: Value,
}

struct RunningServer {
    port: u16,
    shutdown: oneshot::Sender<()>,
    peers: Peers,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct AutomationApiState {
    server: Mutex<Option<RunningServer>>,
    lifecycle: tokio::sync::Mutex<()>,
}

async fn stop_running_server(state: &AutomationApiState) -> Result<(), String> {
    let server = state
        .server
        .lock()
        .map_err(|_| "API state lock failed")?
        .take();
    if let Some(server) = server {
        let _ = server.shutdown.send(());
        let _ = server.task.await;
        server.peers.lock().await.clear();
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationApiStatus {
    running: bool,
    port: Option<u16>,
    connections: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendRequest {
    connection_id: String,
    request: Value,
}

static CONNECTION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn event_matches(pattern: &str, name: &str) -> bool {
    pattern == "*"
        || pattern == name
        || pattern
            .strip_suffix('*')
            .is_some_and(|prefix| name.starts_with(prefix))
}

fn filters_match(filters: &Value, data: &Value) -> bool {
    let Some(filters) = filters.as_object() else {
        return true;
    };
    filters.iter().all(|(key, expected)| {
        expected.is_null()
            || data.get(key) == Some(expected)
            || data.get("room").and_then(|room| room.get(key)) == Some(expected)
            || data.get("user").and_then(|user| user.get(key)) == Some(expected)
    })
}

async fn send_json(sender: &mpsc::UnboundedSender<Message>, value: Value) {
    let _ = sender.send(Message::Text(value.to_string().into()));
}

async fn serve_connection(
    stream: tokio::net::TcpStream,
    app: tauri::AppHandle,
    api_key: Arc<String>,
    peers: Peers,
) {
    let Ok(socket) = accept_async(stream).await else {
        return;
    };
    let (mut sink, mut source) = socket.split();
    let authenticated = timeout(Duration::from_secs(5), source.next()).await;
    let key_matches =
        match authenticated {
            Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text)
                .ok()
                .is_some_and(|value| {
                    value.get("type").and_then(Value::as_str) == Some("authenticate")
                        && value.get("api_key").and_then(Value::as_str) == Some(api_key.as_str())
                }),
            _ => false,
        };
    if !key_matches {
        let _ = sink
            .send(Message::Text(
                json!({
                    "type": "error",
                    "error": {"code": "unauthorized", "message": "Authentication failed"}
                })
                .to_string()
                .into(),
            ))
            .await;
        let _ = sink.close().await;
        return;
    }

    let connection_id = format!(
        "connection-{}",
        CONNECTION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, mut receiver) = mpsc::unbounded_channel();
    peers.lock().await.insert(
        connection_id.clone(),
        Peer {
            sender: sender.clone(),
            subscriptions: HashMap::new(),
        },
    );
    send_json(
        &sender,
        json!({"type": "authenticated", "protocol": "foxchat.automation.v1"}),
    )
    .await;

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = receiver.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = source.next().await {
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            send_json(
                &sender,
                json!({"type":"error","error":{"code":"invalid_json","message":"Frame is not valid JSON"}}),
            )
            .await;
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("subscribe") => {
                let id = value.get("id").and_then(Value::as_str).unwrap_or("");
                let events = value
                    .get("events")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if id.is_empty() || events.is_empty() {
                    send_json(&sender, json!({"type":"error","id":id,"error":{"code":"invalid_request","message":"subscribe requires id and events"}})).await;
                    continue;
                }
                if let Some(peer) = peers.lock().await.get_mut(&connection_id) {
                    peer.subscriptions.insert(
                        id.to_owned(),
                        Subscription {
                            events,
                            filters: value.get("filters").cloned().unwrap_or(json!({})),
                        },
                    );
                }
                send_json(&sender, json!({"type":"subscribed","id":id})).await;
            }
            Some("unsubscribe") => {
                let id = value.get("id").and_then(Value::as_str).unwrap_or("");
                if let Some(peer) = peers.lock().await.get_mut(&connection_id) {
                    peer.subscriptions.remove(id);
                }
                send_json(&sender, json!({"type":"unsubscribed","id":id})).await;
            }
            Some("request") => {
                let valid = value.get("id").and_then(Value::as_str).is_some()
                    && value.get("method").and_then(Value::as_str).is_some();
                if !valid {
                    send_json(&sender, json!({"type":"error","error":{"code":"invalid_request","message":"request requires string id and method"}})).await;
                    continue;
                }
                let _ = app.emit(
                    "foxchat://automation-request",
                    FrontendRequest {
                        connection_id: connection_id.clone(),
                        request: value,
                    },
                );
            }
            _ => {
                send_json(&sender, json!({"type":"error","error":{"code":"invalid_request","message":"Unknown frame type"}})).await;
            }
        }
    }
    peers.lock().await.remove(&connection_id);
    writer.abort();
}

#[tauri::command]
pub async fn start_automation_api(
    app: tauri::AppHandle,
    state: tauri::State<'_, AutomationApiState>,
    port: u16,
    api_key: String,
    listen_address: String,
) -> Result<u16, String> {
    if api_key.len() < 24 {
        return Err("API key must contain at least 24 characters".into());
    }
    let listen_address = listen_address
        .parse::<std::net::IpAddr>()
        .map_err(|_| format!("Invalid automation API listen address: {listen_address}"))?;
    let _lifecycle = state.lifecycle.lock().await;
    stop_running_server(&state).await?;
    let listener = TcpListener::bind((listen_address, port))
        .await
        .map_err(|error| error.to_string())?;
    let actual_port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let peers: Peers = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let task_peers = peers.clone();
    let key = Arc::new(api_key);
    let (shutdown, mut shutdown_receiver) = oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_receiver => break,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    tauri::async_runtime::spawn(serve_connection(
                        stream,
                        app.clone(),
                        key.clone(),
                        task_peers.clone(),
                    ));
                }
            }
        }
    });
    *state.server.lock().map_err(|_| "API state lock failed")? = Some(RunningServer {
        port: actual_port,
        shutdown,
        peers,
        task,
    });
    Ok(actual_port)
}

#[tauri::command]
pub async fn stop_automation_api(
    state: tauri::State<'_, AutomationApiState>,
) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().await;
    stop_running_server(&state).await
}

#[tauri::command]
pub async fn automation_api_status(
    state: tauri::State<'_, AutomationApiState>,
) -> Result<AutomationApiStatus, String> {
    let (running, port, peers) = {
        let server = state.server.lock().map_err(|_| "API state lock failed")?;
        match server.as_ref() {
            Some(server) => (true, Some(server.port), Some(server.peers.clone())),
            None => (false, None, None),
        }
    };
    let connections = match peers {
        Some(peers) => peers.lock().await.len(),
        None => 0,
    };
    Ok(AutomationApiStatus {
        running,
        port,
        connections,
    })
}

#[tauri::command]
pub async fn publish_automation_event(
    state: tauri::State<'_, AutomationApiState>,
    event: String,
    data: Value,
) -> Result<(), String> {
    let peers = state
        .server
        .lock()
        .map_err(|_| "API state lock failed")?
        .as_ref()
        .map(|server| server.peers.clone());
    let Some(peers) = peers else {
        return Ok(());
    };
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    for peer in peers.lock().await.values() {
        for (subscription_id, subscription) in &peer.subscriptions {
            if subscription
                .events
                .iter()
                .any(|pattern| event_matches(pattern, &event))
                && filters_match(&subscription.filters, &data)
            {
                send_json(
                    &peer.sender,
                    json!({
                        "type":"event",
                        "subscription_id":subscription_id,
                        "event":event,
                        "timestamp":timestamp,
                        "data":data
                    }),
                )
                .await;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn respond_automation_api(
    state: tauri::State<'_, AutomationApiState>,
    connection_id: String,
    response: Value,
) -> Result<(), String> {
    let peers = state
        .server
        .lock()
        .map_err(|_| "API state lock failed")?
        .as_ref()
        .map(|server| server.peers.clone())
        .ok_or("Automation API is not running")?;
    let peers = peers.lock().await;
    let peer = peers
        .get(&connection_id)
        .ok_or("Connection no longer exists")?;
    send_json(&peer.sender, response).await;
    Ok(())
}
