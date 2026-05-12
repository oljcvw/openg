pub fn init_keyring() {
    #[cfg(target_os = "ios")]
    {
        let store = apple_native_keyring_store::protected::Store::new()
            .expect("failed to init iOS keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "android")]
    {
        let store =
            android_native_keyring_store::Store::new().expect("failed to init Android keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "macos")]
    {
        use keyring_core::CredentialStore;
        use std::sync::Arc;

        let store: Arc<CredentialStore> = if let Ok(s) =
            apple_native_keyring_store::protected::Store::new()
        {
            s
        } else {
            apple_native_keyring_store::keychain::Store::new()
                .expect("failed to init macOS keyring")
        };
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "windows")]
    {
        let store =
            windows_native_keyring_store::Store::new().expect("failed to init Windows keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "linux")]
    {
        let store =
            linux_keyutils_keyring_store::Store::new().expect("failed to init Linux keyring");
        keyring_core::set_default_store(store);
    }
}
