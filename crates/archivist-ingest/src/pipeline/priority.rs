//! Keep heavy ingest CPU and disk work from starving the Tauri renderer on Windows.
//!
//! THREAD_MODE_BACKGROUND_BEGIN lowers both CPU scheduling and I/O priority for only the
//! calling thread. The process and WebView stay at their configured priority. The guard
//! restores the thread mode even on early return or panic unwind.

#[must_use]
pub(super) struct BackgroundWorkGuard {
    #[cfg(windows)]
    active: bool,
}

impl BackgroundWorkGuard {
    pub(super) fn enter() -> Self {
        #[cfg(windows)]
        {
            const THREAD_MODE_BACKGROUND_BEGIN: i32 = 0x0001_0000;
            let active =
                unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN) != 0 };
            Self { active }
        }

        #[cfg(not(windows))]
        {
            Self {}
        }
    }
}

#[cfg(windows)]
impl Drop for BackgroundWorkGuard {
    fn drop(&mut self) {
        if self.active {
            const THREAD_MODE_BACKGROUND_END: i32 = 0x0002_0000;
            let _ = unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END) };
        }
    }
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn GetCurrentThread() -> *mut std::ffi::c_void;
    fn SetThreadPriority(thread: *mut std::ffi::c_void, priority: i32) -> i32;
}

#[cfg(test)]
mod tests {
    use super::BackgroundWorkGuard;

    #[test]
    fn background_mode_guard_is_safe_to_enter_and_drop() {
        let guard = BackgroundWorkGuard::enter();
        #[cfg(windows)]
        assert!(
            guard.active,
            "Windows background CPU/I/O mode should be available"
        );
        drop(guard);
    }
}
