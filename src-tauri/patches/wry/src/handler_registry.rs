use std::{
  borrow::Borrow,
  collections::HashMap,
  hash::Hash,
  sync::{Arc, Mutex},
};

/// Clone a callback handle while holding the registry lock, then release it.
pub(crate) fn cloned_handler<K, Q, V>(
  registry: &Mutex<HashMap<K, Arc<V>>>,
  key: &Q,
) -> Option<Arc<V>>
where
  K: Borrow<Q> + Eq + Hash,
  Q: Eq + Hash + ?Sized,
  V: ?Sized,
{
  registry.lock().unwrap().get(key).cloned()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn callback_can_reenter_registry_removal_without_deadlock() {
    type Callback = dyn Fn() + Send + Sync;
    let registry = Arc::new(Mutex::new(HashMap::<String, Arc<Callback>>::new()));
    let callback_registry = Arc::clone(&registry);
    registry.lock().unwrap().insert(
      "webview".into(),
      Arc::new(move || {
        callback_registry.lock().unwrap().remove("webview");
      }),
    );

    let callback = cloned_handler(&registry, "webview").unwrap();
    callback();

    assert!(registry.lock().unwrap().is_empty());
  }
}
