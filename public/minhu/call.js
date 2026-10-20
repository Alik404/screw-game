// A private voice call between the two players (WebRTC). The server only passes the setup messages
// (offer, answer, network candidates) between them; the sound goes straight from one browser to the other.
(function (root) {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  // send(data): relay a setup message to the other player. onChange(): redraw the page.
  function create(opts) {
    const C = {
      state: 'idle', // idle | calling | ringing | connecting | live
      muted: false,
      since: 0,
      error: '',
    };
    let pc = null;
    let local = null;
    let offer = null; // an incoming offer waiting for "answer the call"
    let queued = []; // candidates that came before the other side's description
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.append(audio);

    function set(state, error) {
      C.state = state;
      if (state === 'live' && !C.since) C.since = Date.now();
      if (state === 'idle') C.since = 0;
      C.error = error || '';
      opts.onChange();
    }

    function supported() {
      return !!(root.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function cleanup() {
      if (pc) { try { pc.close(); } catch (e) { /* closed */ } }
      pc = null;
      if (local) local.getTracks().forEach(function (t) { t.stop(); });
      local = null;
      offer = null;
      queued = [];
      audio.srcObject = null;
      C.muted = false;
    }

    function newPeer() {
      pc = new RTCPeerConnection({ iceServers: ICE });
      pc.onicecandidate = function (e) { if (e.candidate) opts.send({ kind: 'ice', c: e.candidate.toJSON() }); };
      pc.ontrack = function (e) { audio.srcObject = e.streams[0]; audio.play().catch(function () {}); };
      pc.onconnectionstatechange = function () {
        if (!pc) return;
        if (pc.connectionState === 'connected') set('live');
        if (pc.connectionState === 'failed') { cleanup(); set('idle', 'تعذّر وصل الصوت بينكم (الشبكة تمنعه). جرّبوا الدردشة.'); }
      };
      return pc;
    }

    function mic() {
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }

    async function flush() {
      const list = queued;
      queued = [];
      for (let i = 0; i < list.length; i++) { try { await pc.addIceCandidate(list[i]); } catch (e) { /* stale */ } }
    }

    // ring the other player
    async function start() {
      if (!supported()) { set('idle', 'متصفحك ما يدعم المكالمات.'); return; }
      if (C.state !== 'idle') return;
      set('calling');
      try {
        local = await mic();
        newPeer();
        local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
        const o = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(o);
        opts.send({ kind: 'offer', sdp: o.sdp });
      } catch (e) {
        cleanup();
        set('idle', e && e.name === 'NotAllowedError' ? 'لازم تسمح للمتصفح يستعمل المايك.' : 'ما قدرنا نشغّل المايك.');
      }
    }

    // pick up an incoming call
    async function accept() {
      if (C.state !== 'ringing' || !offer) return;
      set('connecting');
      try {
        local = await mic();
        newPeer();
        local.getTracks().forEach(function (t) { pc.addTrack(t, local); });
        await pc.setRemoteDescription({ type: 'offer', sdp: offer });
        offer = null;
        await flush();
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        opts.send({ kind: 'answer', sdp: a.sdp });
      } catch (e) {
        opts.send({ kind: 'hangup' });
        cleanup();
        set('idle', e && e.name === 'NotAllowedError' ? 'لازم تسمح للمتصفح يستعمل المايك.' : 'ما قدرنا نشغّل المايك.');
      }
    }

    function decline() { opts.send({ kind: 'decline' }); cleanup(); set('idle'); }
    function hangup() { if (C.state === 'idle') return; opts.send({ kind: 'hangup' }); cleanup(); set('idle'); }
    function mute() {
      if (!local) return;
      C.muted = !C.muted;
      local.getAudioTracks().forEach(function (t) { t.enabled = !C.muted; });
      opts.onChange();
    }

    // a setup message from the other player; mySeatFirst breaks a tie when both call at the same moment
    async function onSignal(data, mySeatFirst) {
      try {
        if (data.kind === 'offer') {
          if (C.state === 'calling' && mySeatFirst) return; // both rang: mine wins, theirs is dropped
          if (C.state === 'live' || C.state === 'connecting') return;
          const both = C.state === 'calling';
          if (both) cleanup();
          offer = data.sdp;
          set('ringing');
          if (both) { accept(); return; } // we both wanted to talk: just pick up
          if (opts.onRing) opts.onRing();
        } else if (data.kind === 'answer') {
          if (!pc) return;
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          await flush();
          set('connecting');
        } else if (data.kind === 'ice') {
          if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(data.c); } catch (e) { /* stale */ } } else queued.push(data.c);
        } else if (data.kind === 'decline') {
          cleanup();
          set('idle', 'رفض المكالمة.');
        } else if (data.kind === 'hangup') {
          cleanup();
          set('idle', C.state === 'ringing' ? 'لغى الاتصال.' : 'انتهت المكالمة.');
        }
      } catch (e) {
        cleanup();
        set('idle', 'تعذّرت المكالمة.');
      }
    }

    C.supported = supported;
    C.start = start;
    C.accept = accept;
    C.decline = decline;
    C.hangup = hangup;
    C.mute = mute;
    C.onSignal = onSignal;
    C.end = function () { if (C.state !== 'idle') hangup(); };
    return C;
  }

  root.MinhuCall = { create: create };
})(window);
