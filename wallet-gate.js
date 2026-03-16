
var GOBINOS_GATE = (function () {

  var CONTRACT = '0x5f4a162f85e0a958faaef579ca220143607a5b64';
  var ABI      = ['function balanceOf(address owner) view returns (uint256)'];
  var FN_BASE  = 'https://wlqgibttbggikhdfporr.supabase.co/functions/v1';
  var SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscWdpYnR0YmdnaWtoZGZwb3JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODU4OTksImV4cCI6MjA4ODU2MTg5OX0.lXv-5cR6ZkigZTou_y-oAXMV5BjH9Zhe4Gercc5rdbg';

  var _provider = null;
  var _wallet   = null;

  // ── UI state machine ───────────────────────────────────────────────────────
  function showState(id) {
    ['wgLoading', 'wgConnect', 'wgWrongNet', 'wgNotHolder', 'wgPreMint'].forEach(function (s) {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
    document.getElementById('walletGate').style.display = 'flex';
  }

  function hideGate() {
    document.getElementById('walletGate').style.display = 'none';
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    // Issue 10 fix: guard against ethers failing to load (CDN block, network error)
    if (typeof ethers === 'undefined') {
      console.error('[gate] ethers.js not loaded — check ethers.umd.min.js is in repo root');
      showState('wgConnect'); // show connect card so user isn't stuck on spinner
      return;
    }

    showState('wgLoading');

    // ── GateOpen check — connect button locked until mint is done ────────────
    // Set GateOpen = 1 in Supabase config table to open the gate after mint.
    try {
      var cfgRes = await fetch(
        'https://wlqgibttbggikhdfporr.supabase.co/rest/v1/config?name=eq.GateOpen&select=value',
        { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
      );
      var cfgData = await cfgRes.json();
      var gateOpen = cfgData && cfgData[0] && cfgData[0].value === '1';
      if (!gateOpen) {
        showState('wgPreMint');
        return; // stop init — no connect button, no wallet check
      }
    } catch (e) {
      // If config fetch fails, fail closed — keep gate locked
      console.error('[gate] GateOpen config fetch failed:', e.message);
      showState('wgPreMint');
      return;
    }

    document.getElementById('wgConnectBtn').addEventListener('click', connect);
    document.getElementById('wgDisconnectBtn').addEventListener('click', disconnect);
    document.getElementById('wgSwitchBtn').addEventListener('click', switchNetwork);

    // Re-verify on every tab focus — never trust stale state
    window.addEventListener('focus', function () {
      if (_wallet && _provider) verifyHolder(_wallet);
    });

    if (window.ethereum) {
      // ── Wallet switch: gate snaps back up instantly, then re-verifies ──
      // Fires when user picks a different account in MetaMask — even mid-game.
      window.ethereum.on('accountsChanged', function (accounts) {
        if (!accounts || !accounts.length) {
          _provider = null;
          _wallet   = null;
          try { localStorage.removeItem('gobWallet'); } catch (e) {}
          showState('wgConnect');
          return;
        }
        var newWallet = ethers.getAddress(accounts[0]);
        if (newWallet === _wallet) return; // same wallet — ignore
        // Different wallet — kill session, show gate, re-verify
        _provider = new ethers.BrowserProvider(window.ethereum);
        _wallet   = newWallet;
        try { localStorage.removeItem('gobWallet'); } catch (e) {}
        showState('wgLoading');
        verifyHolder(_wallet);
      });

      window.ethereum.on('chainChanged', function () {
        window.location.reload();
      });
    }

    // Silent reconnect — passive check, never triggers MetaMask popup
    var saved = null;
    try { saved = localStorage.getItem('gobWallet'); } catch (e) {}

    if (saved && window.ethereum) {
      try {
        var accounts = await window.ethereum.request({ method: 'eth_accounts' });
        var match = accounts.find(function (a) {
          return a.toLowerCase() === saved.toLowerCase();
        });
        if (match) {
          _provider = new ethers.BrowserProvider(window.ethereum);
          var network = await _provider.getNetwork();
          if (network.chainId !== 1n) { showState('wgWrongNet'); return; }
          _wallet = ethers.getAddress(match);
          await verifyHolder(_wallet);
          return;
        }
      } catch (e) { /* MetaMask locked or unavailable */ }
    }

    showState('wgConnect');
  }

  // ── Connect wallet ─────────────────────────────────────────────────────────
  async function connect() {
    showState('wgLoading');
    try {
      if (!window.ethereum) {
        alert('No wallet detected. Install MetaMask to play.');
        showState('wgConnect');
        return;
      }
      var provider = new ethers.BrowserProvider(window.ethereum);
      var accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts || !accounts.length) { showState('wgConnect'); return; }

      var network = await provider.getNetwork();
      if (network.chainId !== 1n) { showState('wgWrongNet'); return; }

      _provider = provider;
      _wallet   = ethers.getAddress(accounts[0]);
      await verifyHolder(_wallet);
    } catch (e) {
      if (e.code === 4001) {
        showState('wgConnect');
      } else {
        console.error('[gate] connect failed', e);
        showState('wgConnect');
      }
    }
  }

  // ── On-chain verify + sign + session token ─────────────────────────────────
  async function verifyHolder(wallet) {
    showState('wgLoading');
    try {
      var contract = new ethers.Contract(CONTRACT, ABI, _provider);
      var balance  = await contract.balanceOf(wallet);

      if (false && balance < 1n) {


      var signer = await _provider.getSigner();
      var nonce  = crypto.randomUUID();
      var msg    = 'Gobinos: verify wallet ownership.\nNonce: ' + nonce;

      var sig;
      try {
        sig = await signer.signMessage(msg);
      } catch (signErr) {
        if (signErr.code === 4001) {
          showState('wgConnect');
          return;
        }
        throw signErr;
      }

      var r = await fetch(FN_BASE + '/issue-session', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + SB_KEY
        },
        body: JSON.stringify({
          wallet:    wallet.toLowerCase(),
          signature: sig,
          nonce:     nonce,
          // Fix 1B: pass saved handle so JWT twitter field is populated for score submission
          twitter:   (function(){ try { return localStorage.getItem('gobHandle') || ''; } catch(e) { return ''; } })()
        })
      });

      if (!r.ok) {
        var errData = await r.json().catch(function () { return {}; });
        throw new Error(errData.error || 'session failed (' + r.status + ')');
      }

      var d = await r.json();
      if (!d.token) throw new Error('no token returned');

      try { localStorage.setItem('gobWallet', wallet); } catch (e) {}
      // Use the one-time self-destructing bridge — _setWalletAuth is not on _gob
      if (typeof window.__gobSetAuth !== 'function') {
        throw new Error('auth bridge already used or not available — refresh the page');
      }
      window.__gobSetAuth(wallet.toLowerCase(), d.token);
      hideGate();

    } catch (e) {
      console.error('[gate] verifyHolder failed:', e.message || e);
      showState('wgConnect');
    }
  }

  // ── Switch to mainnet ──────────────────────────────────────────────────────
  async function switchNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }]
      });
      await connect();
    } catch (e) {
      console.error('[gate] network switch failed', e);
    }
  }

  // ── Disconnect — actually revokes MetaMask site permission ─────────────────
  // wallet_revokePermissions tells MetaMask this site no longer has access.
  // Next connect click shows the full account picker — not old wallet auto-selected.
  async function disconnect() {
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }]
        });
      } catch (e) {
        // Older MetaMask versions don't support this — falls back to UI-only disconnect
      }
    }
    _provider = null;
    _wallet   = null;
    try { localStorage.removeItem('gobWallet'); } catch (e) {}
    showState('wgConnect');
  }

  init();

  // Fix 6: refreshToken — get a fresh session token for "keep grinding" with NO MetaMask prompt.
  // Sends the existing valid token to refresh-session, which re-verifies NFT balance server-side
  // and issues a new JWT with a fresh nonce. No wallet signature required.
  // Fix 2: token passed as parameter — no window read bridge needed
  async function refreshToken(currentToken) {
    if (!_wallet) return;

    if (!currentToken) {
      // No token available — fall back to full re-verify (will prompt MetaMask)
      if (_provider) await verifyHolder(_wallet);
      return;
    }

    try {
      var r = await fetch(FN_BASE + '/refresh-session', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   'Bearer ' + SB_KEY,
          'x-session-token': currentToken
        },
        body: JSON.stringify({})
      });
      if (!r.ok) {
        // Token expired or NFT no longer held — fall back to full re-verify
        if (_provider) await verifyHolder(_wallet);
        return;
      }
      var d = await r.json();
      if (d.token && typeof window.__gobSetAuth === 'function') {
        window.__gobSetAuth(_wallet.toLowerCase(), d.token);
      }
    } catch(e) {
      console.error('[gate] refreshToken failed:', e.message);
      if (_provider) await verifyHolder(_wallet);
    }
  }

  return { disconnect: disconnect, refreshToken: refreshToken };

})();
