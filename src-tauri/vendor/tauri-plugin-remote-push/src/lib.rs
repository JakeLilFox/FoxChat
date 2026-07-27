use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

mod commands;
mod error;
#[cfg(mobile)]
mod mobile;
#[cfg(desktop)]
mod desktop;

pub use error::{Error, Result};

#[cfg(mobile)]
use mobile::RemotePush;
#[cfg(desktop)]
use desktop::RemotePush;

pub trait RemotePushExt<R: Runtime> {
  fn remote_push(&self) -> &RemotePush<R>;
}

impl<R: Runtime, T: Manager<R>> RemotePushExt<R> for T {
  fn remote_push(&self) -> &RemotePush<R> {
    self.state::<RemotePush<R>>().inner()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("remote-push")
    .invoke_handler(tauri::generate_handler![commands::get_token, commands::request_permission, commands::clear_room_notification])
    .setup(|app, api| {
      let remote_push = RemotePush::init(app, api)?;
      app.manage(remote_push);
      Ok(())
    })
    .build()
}
