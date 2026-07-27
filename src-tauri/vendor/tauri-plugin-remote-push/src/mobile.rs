use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{plugin::{PluginApi, PluginHandle}, AppHandle, Runtime};

#[derive(Deserialize)]
struct TokenResponse {
  token: String,
}

#[derive(Serialize)]
struct ClearRoomArgs {
  #[serde(rename = "roomId")]
  room_id: String,
}

pub struct RemotePush<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> RemotePush<R> {
  pub fn init<C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
  ) -> crate::Result<Self> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("app.tauri.remotepush", "PushNotificationPlugin")?;
    #[cfg(target_os = "ios")]
    return Err(crate::Error::Unsupported);
    #[cfg(target_os = "android")]
    Ok(Self(handle))
  }

  pub fn get_token(&self) -> crate::Result<String> {
    let response: TokenResponse = self.0.run_mobile_plugin("getToken", ())?;
    Ok(response.token)
  }

  pub fn request_permission(&self) -> crate::Result<()> {
    self.0.run_mobile_plugin("requestPermissions", ()).map_err(Into::into)
  }

  pub fn clear_room_notification(&self, room_id: String) -> crate::Result<()> {
    self.0.run_mobile_plugin("clearRoomNotification", ClearRoomArgs { room_id }).map_err(Into::into)
  }
}
