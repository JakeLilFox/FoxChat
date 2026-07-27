// This list generates the Tauri ACL entries for both Rust commands and
// Android-only Kotlin commands. A @Command method is still rejected before it
// reaches Android unless it is declared here and included in a capability.
const COMMANDS: &[&str] = &[
  "get_token",
  "request_permission",
  "clear_room_notification",
  "update_notification",
  "sync_native_crypto",
  "native_crypto_status",
  "test_native_crypto",
  "test_android_auto_notification",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
