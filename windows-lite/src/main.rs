#![cfg_attr(windows, windows_subsystem = "windows")]
#![cfg_attr(not(windows), allow(dead_code))]
mod api;
mod model;
#[cfg(windows)]
mod preferences;
mod worker;
#[cfg(windows)]
extern crate native_windows_gui as nwg;
#[cfg(windows)]
mod ui;
#[cfg(windows)]
fn main() {
    ui::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Приложение предназначено для Windows.");
}
