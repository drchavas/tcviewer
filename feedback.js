/* feedback.js — "Send feedback" pop-up for tcviewer.org and extremewx.org (shared copy in each site).
   Any element with a data-feedback attribute (or href="#feedback") opens it; window.openFeedback() too.
   data-feedback="error" (or "suggestion", "question") preselects the type.
   Submissions go to a Google Form (owner: Dan Chavas) → its Responses tab / linked Sheet, not an inbox.
   The form's entry ids below come from that form; if a question is ever re-created, update them. */
(function(){
  if(window.openFeedback) return;
  const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSe_RXc-PxXPtwkYYKdqByvtA6vA-9Paonn7Sg7D7QoE6LSm4Q/formResponse';
  const F = {type:'entry.1959519267', msg:'entry.1022086739', name:'entry.567222408', email:'entry.865622496', page:'entry.833572569'};
  const TYPES = [['error', 'Error / something looks wrong'], ['suggestion', 'Suggestion / feature request'],
                 ['question', 'Question'], ['other', 'Other']];

  const css = `
  .fbk-back{position:fixed;inset:0;z-index:100000;background:rgba(5,9,14,.62);display:flex;align-items:center;justify-content:center;padding:16px}
  .fbk-back[hidden]{display:none}
  .fbk{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:#16212e;color:#e8eef5;border:1px solid #2a3a4d;
    border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.5);padding:18px 18px 16px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:relative}
  .fbk h2{margin:0 0 2px;font-size:18px;font-weight:700;color:#fff}
  .fbk .fbk-sub{margin:0 0 12px;color:#9fb0c3;font-size:13px}
  .fbk label{display:block;margin:10px 0 4px;font-size:12px;font-weight:600;letter-spacing:.03em;color:#b9c6d4}
  .fbk label span{font-weight:400;color:#7f91a5;letter-spacing:0}
  .fbk select,.fbk input,.fbk textarea{width:100%;box-sizing:border-box;background:#0f1822;color:#e8eef5;border:1px solid #2f4257;border-radius:8px;
    padding:8px 10px;font:inherit;font-size:14px}
  .fbk textarea{min-height:120px;resize:vertical}
  .fbk select:focus,.fbk input:focus,.fbk textarea:focus{outline:2px solid #4d9bff;outline-offset:0;border-color:#4d9bff}
  .fbk .fbk-row{display:flex;gap:10px}.fbk .fbk-row>div{flex:1;min-width:0}
  .fbk .fbk-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .fbk .fbk-act{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px}
  .fbk .fbk-status{margin-right:auto;font-size:13px;color:#9fb0c3}
  .fbk .fbk-status.err{color:#ff8a7a}.fbk .fbk-status.ok{color:#7ddc9a}
  .fbk button{font:inherit;font-size:14px;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid #2f4257;background:#1d2b3b;color:#e8eef5}
  .fbk button.fbk-send{background:#2f7ae5;border-color:#2f7ae5;color:#fff;font-weight:600}
  .fbk button.fbk-send:disabled{opacity:.55;cursor:default}
  .fbk .fbk-x{position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c3;font-size:22px;line-height:1;padding:4px 6px}
  .fbk .fbk-x:hover{color:#fff}
  .fbk .fbk-note{margin-top:10px;font-size:12px;color:#7f91a5}
  @media (max-width:480px){.fbk .fbk-row{flex-direction:column;gap:0}}`;

  let back, form, status, sendBtn, lastFocus;
  function build(){
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    back = document.createElement('div'); back.className = 'fbk-back'; back.hidden = true;
    back.innerHTML = `
      <form class="fbk" role="dialog" aria-modal="true" aria-labelledby="fbk-title" novalidate>
        <button type="button" class="fbk-x" aria-label="Close">×</button>
        <h2 id="fbk-title">Send feedback</h2>
        <p class="fbk-sub">Spotted a problem, have an idea, or a question? It goes straight to the developer.</p>
        <label for="fbk-type">Type</label>
        <select id="fbk-type" name="type">${TYPES.map(([k, t]) => `<option value="${t}" data-k="${k}">${t}</option>`).join('')}</select>
        <label for="fbk-msg">Message</label>
        <textarea id="fbk-msg" name="msg" maxlength="5000" placeholder="What did you see or what would you like? If something looks wrong, say which storm, place or layer."></textarea>
        <div class="fbk-row">
          <div><label for="fbk-name">Name <span>(optional)</span></label><input id="fbk-name" name="name" autocomplete="name" maxlength="200"></div>
          <div><label for="fbk-email">Email <span>(optional, for a reply)</span></label><input id="fbk-email" name="email" type="email" autocomplete="email" maxlength="200"></div>
        </div>
        <div class="fbk-hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="fbk-note">The page you're on is sent with your message so the problem can be found.</div>
        <div class="fbk-act"><span class="fbk-status" role="status"></span>
          <button type="button" class="fbk-cancel">Cancel</button><button type="submit" class="fbk-send">Send</button></div>
      </form>`;
    document.body.appendChild(back);
    form = back.querySelector('form'); status = back.querySelector('.fbk-status'); sendBtn = back.querySelector('.fbk-send');
    back.addEventListener('mousedown', e => { if(e.target === back) close(); });
    back.querySelector('.fbk-x').onclick = close; back.querySelector('.fbk-cancel').onclick = close;
    back.addEventListener('keydown', e => {
      if(e.key === 'Escape'){ e.stopPropagation(); close(); }
      if(e.key === 'Tab'){                          // keep focus inside the dialog
        const f = [...form.querySelectorAll('button,select,input:not([tabindex="-1"]),textarea')].filter(x => x.offsetParent);
        const i = f.indexOf(document.activeElement);
        if(e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); }
        else if(!e.shiftKey && i === f.length - 1){ e.preventDefault(); f[0].focus(); }
      }
    });
    form.addEventListener('submit', send);
  }
  function setStatus(t, cls){ status.textContent = t; status.className = 'fbk-status' + (cls ? ' ' + cls : ''); }
  function open(kind){
    if(!back) build();
    lastFocus = document.activeElement;
    if(kind){ const o = [...form.type.options].find(o => o.dataset.k === kind); if(o) form.type.value = o.value; }
    setStatus(''); sendBtn.disabled = false;
    back.hidden = false; document.documentElement.style.overflow = 'hidden';
    setTimeout(() => form.msg.focus(), 30);
  }
  function close(){
    if(!back || back.hidden) return;
    back.hidden = true; document.documentElement.style.overflow = '';
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  async function send(e){
    e.preventDefault();
    const msg = form.msg.value.trim(), email = form.email.value.trim();
    if(msg.length < 3){ setStatus('Please write a message.', 'err'); form.msg.focus(); return; }
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ setStatus('That email doesn’t look right.', 'err'); form.email.focus(); return; }
    if(form.website.value){ setStatus('Thanks!', 'ok'); setTimeout(close, 1200); return; }   // bot filled the honeypot
    const page = `${location.href} | ${window.innerWidth}×${window.innerHeight} | ${navigator.userAgent}`.slice(0, 1000);
    const body = new URLSearchParams({[F.type]: form.type.value, [F.msg]: msg, [F.name]: form.name.value.trim(),
                                      [F.email]: email, [F.page]: page});
    sendBtn.disabled = true; setStatus('Sending…');
    try{
      await fetch(FORM, {method:'POST', mode:'no-cors', body});   // Google Forms gives an opaque reply; a network error throws
      setStatus('Thanks — sent!', 'ok');
      form.msg.value = '';
      setTimeout(close, 1600);
    }catch(err){
      sendBtn.disabled = false;
      setStatus('Couldn’t send — check your connection and try again.', 'err');
    }
  }
  window.openFeedback = open;
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-feedback],a[href="#feedback"]');
    if(!a) return;
    e.preventDefault(); open(a.getAttribute('data-feedback') || '');
  });
  if(location.hash === '#feedback') addEventListener('load', () => open(''));
})();
