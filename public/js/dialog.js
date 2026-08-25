// Styled replacements for native alert()/confirm() - oversized/ugly on mobile.
// Markup self-injects; requires .contacts-modal-overlay/.key-modal CSS from styles.css.
(function () {
  if (document.getElementById('appDialogOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'appDialogOverlay';
  overlay.className = 'contacts-modal-overlay';
  overlay.innerHTML = `
    <div class="contacts-modal key-modal">
      <div class="contacts-modal-header"><span id="appDialogTitle">Notice</span></div>
      <div class="key-modal-body">
        <p id="appDialogMessage"></p>
        <div class="key-modal-actions">
          <button id="appDialogCancel" style="display:none">CANCEL</button>
          <button id="appDialogOk">OK</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let resolveFn = null;

  function openDialog(title, message, showCancel, danger) {
    document.getElementById('appDialogTitle').textContent = title;
    document.getElementById('appDialogMessage').textContent = message;
    document.getElementById('appDialogCancel').style.display = showCancel ? '' : 'none';
    document.getElementById('appDialogOk').classList.toggle('danger', !!danger);
    overlay.classList.add('active');
  }

  function close(value) {
    overlay.classList.remove('active');
    if (resolveFn) { resolveFn(value); resolveFn = null; }
  }

  // Fire-and-forget OK: appAlert('msg'). Await it when you need blocking behavior.
  window.appAlert = function (message, title, opts) {
    openDialog(title || 'Notice', message, false, opts && opts.danger);
    return new Promise(r => { resolveFn = r; });
  };

  // Must await: returns true/false
  window.appConfirm = function (message, title, opts) {
    openDialog(title || 'Confirm', message, true, opts && opts.danger);
    return new Promise(r => { resolveFn = r; });
  };

  document.getElementById('appDialogOk').addEventListener('click', () => close(true));
  document.getElementById('appDialogCancel').addEventListener('click', () => close(false));
})();