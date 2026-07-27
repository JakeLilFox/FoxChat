use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

pub struct RemotePush<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> RemotePush<R> {
  pub fn init<C: DeserializeOwned>(_app: &AppHandle<R>, _api: PluginApi<R, C>) -> crate::Result<Self> {
    Ok(Self(std::marker::PhantomData))
  }
  pub fn get_token(&self) -> crate::Result<String> { Err(crate::Error::Unsupported) }
  pub fn request_permission(&self) -> crate::Result<()> { Err(crate::Error::Unsupported) }
  pub fn clear_room_notification(&self, _room_id: String) -> crate::Result<()> { Err(crate::Error::Unsupported) }
}
