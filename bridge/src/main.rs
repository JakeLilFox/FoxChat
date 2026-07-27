#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs, io,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, Mutex},
    time::{timeout, Duration},
};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request, Response},
        Message,
    },
};

const PORT: u16 = 29331;
const OFFICIAL_ORIGIN: &str = "https://chat.jakefox.de";
static CONNECTION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

type Sender = mpsc::UnboundedSender<Message>;

#[derive(Clone)]
struct Subscription {
    events: Vec<String>,
    filters: Value,
}

struct Consumer {
    sender: Sender,
    subscriptions: HashMap<String, Subscription>,
}

struct Provider {
    id: String,
    sender: Sender,
    api_key: String,
}

#[derive(Default)]
struct BridgeState {
    provider: Option<Provider>,
    consumers: HashMap<String, Consumer>,
}

fn text(value: Value) -> Message {
    Message::Text(value.to_string().into())
}

fn send(sender: &Sender, value: Value) {
    let _ = sender.send(text(value));
}

fn close(sender: &Sender, reason: &str) {
    send(
        sender,
        json!({"type":"error","error":{"code":"provider_replaced","message":reason}}),
    );
    let _ = sender.send(Message::Close(None));
}

fn provider_origin_allowed(origin: &str) -> bool {
    origin == OFFICIAL_ORIGIN
        || origin.starts_with("http://localhost:")
        || origin.starts_with("https://localhost:")
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("https://127.0.0.1:")
}

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

async fn authenticate(
    source: &mut futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
) -> Option<Value> {
    match timeout(Duration::from_secs(5), source.next()).await {
        Ok(Some(Ok(Message::Text(frame)))) => serde_json::from_str(&frame).ok(),
        _ => None,
    }
}

async fn run_writer(
    mut sink: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<TcpStream>,
        Message,
    >,
    mut receiver: mpsc::UnboundedReceiver<Message>,
) {
    while let Some(message) = receiver.recv().await {
        if sink.send(message).await.is_err() {
            break;
        }
    }
}

async fn serve(stream: TcpStream, state: Arc<Mutex<BridgeState>>) {
    let origin = Arc::new(std::sync::Mutex::new(String::new()));
    let captured_origin = origin.clone();
    let socket = accept_hdr_async(stream, move |request: &Request, response: Response| {
        if request.uri().path() != "/v1" {
            // Keep the handshake response simple; protocol validation follows authentication.
        }
        if let Some(value) = request
            .headers()
            .get("origin")
            .and_then(|value| value.to_str().ok())
        {
            *captured_origin.lock().expect("origin lock") = value.to_owned();
        }
        Ok(response)
    })
    .await;
    let Ok(socket) = socket else {
        return;
    };
    let origin = origin.lock().expect("origin lock").clone();
    let (sink, mut source) = socket.split();
    let Some(auth) = authenticate(&mut source).await else {
        return;
    };
    if auth.get("type").and_then(Value::as_str) != Some("authenticate") {
        return;
    }
    let api_key = auth
        .get("api_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if api_key.len() < 24 {
        return;
    }
    let role = auth
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("consumer");
    let id = format!(
        "connection-{}",
        CONNECTION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = mpsc::unbounded_channel();
    let writer = tokio::spawn(run_writer(sink, receiver));

    if role == "matrix_client" {
        if !provider_origin_allowed(&origin) {
            send(
                &sender,
                json!({"type":"error","error":{"code":"origin_denied","message":"This origin cannot register as a Matrix provider"}}),
            );
            drop(sender);
            let _ = writer.await;
            return;
        }
        {
            let mut bridge = state.lock().await;
            if let Some(previous) = bridge.provider.take() {
                close(&previous.sender, "A newer FoxChat Matrix client connected");
            }
            for consumer in bridge.consumers.values() {
                close(
                    &consumer.sender,
                    "The FoxChat Matrix provider changed; reconnect and authenticate again",
                );
            }
            bridge.consumers.clear();
            bridge.provider = Some(Provider {
                id: id.clone(),
                sender: sender.clone(),
                api_key,
            });
        }
        send(
            &sender,
            json!({"type":"authenticated","protocol":"foxchat.bridge.v1","role":"matrix_client"}),
        );
        serve_provider(id, sender, source, state).await;
    } else {
        let authorized = {
            let bridge = state.lock().await;
            bridge
                .provider
                .as_ref()
                .is_some_and(|provider| provider.api_key == api_key)
        };
        if !authorized {
            send(
                &sender,
                json!({"type":"error","error":{"code":"unauthorized","message":"No matching FoxChat provider is connected"}}),
            );
            drop(sender);
            let _ = writer.await;
            return;
        }
        state.lock().await.consumers.insert(
            id.clone(),
            Consumer {
                sender: sender.clone(),
                subscriptions: HashMap::new(),
            },
        );
        send(
            &sender,
            json!({"type":"authenticated","protocol":"foxchat.automation.v1","role":"consumer"}),
        );
        serve_consumer(id, sender, source, state).await;
    }
    writer.abort();
}

async fn serve_provider(
    id: String,
    sender: Sender,
    mut source: futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
    state: Arc<Mutex<BridgeState>>,
) {
    while let Some(Ok(Message::Text(frame))) = source.next().await {
        let Ok(value) = serde_json::from_str::<Value>(&frame) else {
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("bridge_response") => {
                let connection_id = value
                    .get("connection_id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let response = value.get("response").cloned().unwrap_or(json!({}));
                if let Some(consumer) = state.lock().await.consumers.get(connection_id) {
                    send(&consumer.sender, response);
                }
            }
            Some("publish") => {
                let event = value.get("event").and_then(Value::as_str).unwrap_or("");
                let data = value.get("data").cloned().unwrap_or(json!({}));
                let timestamp = value.get("timestamp").cloned().unwrap_or_else(|| json!(0));
                let bridge = state.lock().await;
                for consumer in bridge.consumers.values() {
                    for (subscription_id, subscription) in &consumer.subscriptions {
                        if subscription
                            .events
                            .iter()
                            .any(|pattern| event_matches(pattern, event))
                            && filters_match(&subscription.filters, &data)
                        {
                            send(
                                &consumer.sender,
                                json!({
                                    "type":"event",
                                    "subscription_id":subscription_id,
                                    "event":event,
                                    "timestamp":timestamp,
                                    "data":data
                                }),
                            );
                        }
                    }
                }
            }
            Some("heartbeat") => send(&sender, json!({"type":"heartbeat_ack"})),
            _ => {}
        }
    }
    let mut bridge = state.lock().await;
    if bridge
        .provider
        .as_ref()
        .is_some_and(|provider| provider.id == id)
    {
        bridge.provider = None;
        for consumer in bridge.consumers.values() {
            close(&consumer.sender, "The FoxChat Matrix provider disconnected");
        }
        bridge.consumers.clear();
    }
}

async fn serve_consumer(
    id: String,
    sender: Sender,
    mut source: futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>,
    state: Arc<Mutex<BridgeState>>,
) {
    while let Some(Ok(Message::Text(frame))) = source.next().await {
        let Ok(value) = serde_json::from_str::<Value>(&frame) else {
            send(
                &sender,
                json!({"type":"error","error":{"code":"invalid_json","message":"Frame is not valid JSON"}}),
            );
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("subscribe") => {
                let subscription_id = value.get("id").and_then(Value::as_str).unwrap_or("");
                let events = value
                    .get("events")
                    .and_then(Value::as_array)
                    .map(|events| {
                        events
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if subscription_id.is_empty() || events.is_empty() {
                    send(
                        &sender,
                        json!({"type":"error","error":{"code":"invalid_request","message":"subscribe requires id and events"}}),
                    );
                    continue;
                }
                if let Some(consumer) = state.lock().await.consumers.get_mut(&id) {
                    consumer.subscriptions.insert(
                        subscription_id.to_owned(),
                        Subscription {
                            events,
                            filters: value.get("filters").cloned().unwrap_or(json!({})),
                        },
                    );
                }
                send(&sender, json!({"type":"subscribed","id":subscription_id}));
            }
            Some("unsubscribe") => {
                let subscription_id = value.get("id").and_then(Value::as_str).unwrap_or("");
                if let Some(consumer) = state.lock().await.consumers.get_mut(&id) {
                    consumer.subscriptions.remove(subscription_id);
                }
                send(&sender, json!({"type":"unsubscribed","id":subscription_id}));
            }
            Some("request") => {
                if value.get("id").and_then(Value::as_str).is_none()
                    || value.get("method").and_then(Value::as_str).is_none()
                {
                    send(
                        &sender,
                        json!({"type":"error","error":{"code":"invalid_request","message":"request requires string id and method"}}),
                    );
                    continue;
                }
                let provider = state
                    .lock()
                    .await
                    .provider
                    .as_ref()
                    .map(|provider| provider.sender.clone());
                if let Some(provider) = provider {
                    send(
                        &provider,
                        json!({"type":"bridge_request","connection_id":id,"request":value}),
                    );
                } else {
                    send(
                        &sender,
                        json!({"type":"response","id":value.get("id"),"ok":false,"error":{"code":"not_ready","message":"FoxChat is not connected"}}),
                    );
                }
            }
            _ => send(
                &sender,
                json!({"type":"error","error":{"code":"invalid_request","message":"Unknown frame type"}}),
            ),
        }
    }
    state.lock().await.consumers.remove(&id);
}

#[cfg(windows)]
fn install() -> io::Result<()> {
    let base =
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is unavailable")
        })?)
        .join("FoxChat Bridge");
    fs::create_dir_all(&base)?;
    let target = base.join("foxchat-bridge.exe");
    let current = env::current_exe()?;
    if current != target {
        fs::copy(&current, &target)?;
    }
    let command = format!("\"{}\" --background", target.display());
    let status = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "FoxChatBridge",
            "/t",
            "REG_SZ",
            "/d",
            &command,
            "/f",
        ])
        .status()?;
    if !status.success() {
        return Err(io::Error::other("Could not configure Windows autostart"));
    }
    Command::new(target).arg("--background").spawn()?;
    Ok(())
}

#[cfg(unix)]
fn install() -> io::Result<()> {
    let home = PathBuf::from(
        env::var_os("HOME")
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is unavailable"))?,
    );
    let bin = home.join(".local/bin");
    fs::create_dir_all(&bin)?;
    let target = bin.join("foxchat-bridge");
    let current = env::current_exe()?;
    if current != target {
        fs::copy(&current, &target)?;
    }
    let mut permissions = fs::metadata(&target)?.permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    fs::set_permissions(&target, permissions)?;
    let autostart = home.join(".config/autostart");
    fs::create_dir_all(&autostart)?;
    fs::write(
        autostart.join("foxchat-bridge.desktop"),
        format!(
            "[Desktop Entry]\nType=Application\nName=FoxChat Bridge\nExec={} --background\nX-GNOME-Autostart-enabled=true\n",
            target.display()
        ),
    )?;
    Command::new(target).arg("--background").spawn()?;
    Ok(())
}

#[cfg(windows)]
fn uninstall() -> io::Result<()> {
    let _ = Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "FoxChatBridge",
            "/f",
        ])
        .status();
    Ok(())
}

#[cfg(unix)]
fn uninstall() -> io::Result<()> {
    let home = PathBuf::from(
        env::var_os("HOME")
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is unavailable"))?,
    );
    let _ = fs::remove_file(home.join(".config/autostart/foxchat-bridge.desktop"));
    let _ = fs::remove_file(home.join(".local/bin/foxchat-bridge"));
    Ok(())
}

async fn run_server() -> io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", PORT)).await?;
    let state = Arc::new(Mutex::new(BridgeState::default()));
    loop {
        let (stream, _) = listener.accept().await?;
        tokio::spawn(serve(stream, state.clone()));
    }
}

#[tokio::main]
async fn main() -> io::Result<()> {
    let argument = env::args().nth(1);
    match argument.as_deref() {
        Some("--install") => install(),
        Some("--uninstall") => uninstall(),
        Some("--version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => run_server().await,
    }
}
