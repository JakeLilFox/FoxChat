use serde::Serialize;
use std::{env, sync::Mutex};

const HELP: &str = r#"FoxChat desktop CLI options

  --homeserver <url>          Matrix homeserver base URL or server name
  --username <user>           Matrix ID or localpart to sign in as
  --password <password>       Account password (prefer FOXCHAT_PASSWORD instead)
  --recovery-key <key>        Security/recovery key used to unlock encrypted history
  --persist                   Reuse a previously saved session for this account
                               instead of logging in again. Falls back to
                               --password to create one when none is saved yet.
                               With --persist and no --homeserver/--username,
                               resumes whichever account was last active.
  --automation-port <port>    Port for the local automation API
  --automation-key <key>      API key for the local automation API
                               (see AUTOMATION_API.md)
  --headless                  Do not show the application window
  --help, -h                  Print this message and exit

Secrets can also be supplied via the FOXCHAT_PASSWORD, FOXCHAT_RECOVERY_KEY,
FOXCHAT_AUTOMATION_KEY, FOXCHAT_HOMESERVER and FOXCHAT_USERNAME environment
variables instead of arguments, which keeps them out of the process list
(visible to other local users via `ps`/`/proc` on Linux).
"#;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliLoginOptions {
    pub homeserver: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub recovery_key: Option<String>,
    #[serde(default)]
    pub persist: bool,
    pub automation_port: Option<u16>,
    pub automation_key: Option<String>,
    #[serde(default)]
    pub headless: bool,
}

impl CliLoginOptions {
    fn is_empty(&self) -> bool {
        self.homeserver.is_none()
            && self.username.is_none()
            && self.password.is_none()
            && self.recovery_key.is_none()
            && self.automation_port.is_none()
            && self.automation_key.is_none()
            && !self.persist
            && !self.headless
    }
}

pub struct CliState(pub Mutex<CliLoginOptions>);

/// Parses `env::args()` plus environment-variable fallbacks for secrets.
/// Prints `--help` and exits the process directly, matching common CLI tools.
pub fn parse() -> CliLoginOptions {
    let mut options = CliLoginOptions::default();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                std::process::exit(0);
            }
            "--homeserver" => options.homeserver = args.next(),
            "--username" => options.username = args.next(),
            "--password" => options.password = args.next(),
            "--recovery-key" => options.recovery_key = args.next(),
            "--automation-port" => {
                options.automation_port = args.next().and_then(|value| value.parse().ok())
            }
            "--automation-key" => options.automation_key = args.next(),
            "--persist" => options.persist = true,
            "--headless" => options.headless = true,
            _ => {}
        }
    }
    if options.homeserver.is_none() {
        options.homeserver = env::var("FOXCHAT_HOMESERVER").ok();
    }
    if options.username.is_none() {
        options.username = env::var("FOXCHAT_USERNAME").ok();
    }
    if options.password.is_none() {
        options.password = env::var("FOXCHAT_PASSWORD").ok();
    }
    if options.recovery_key.is_none() {
        options.recovery_key = env::var("FOXCHAT_RECOVERY_KEY").ok();
    }
    if options.automation_key.is_none() {
        options.automation_key = env::var("FOXCHAT_AUTOMATION_KEY").ok();
    }
    options
}

/// Returns the CLI-provided login options once, then clears them so a later
/// page reload (e.g. after switching accounts) falls back to the normal
/// saved-session flow instead of repeating the CLI login.
#[tauri::command]
pub fn cli_login_options(state: tauri::State<'_, CliState>) -> Option<CliLoginOptions> {
    let mut guard = state.0.lock().ok()?;
    if guard.is_empty() {
        return None;
    }
    Some(std::mem::take(&mut *guard))
}

#[tauri::command]
pub fn cli_log(message: String) {
    eprintln!("{message}");
}
