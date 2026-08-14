// Windows release'te arka-plan konsol penceresini gizle.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    archivist_lib::run();
}
