var GOBINOS_GATE = (function () {

  var CONTRACT = '0x5f4a162f85e0a958faaef579ca220143607a5b64';
  var ABI      = ['function balanceOf(address owner) view returns (uint256)'];
  var FN_BASE  = 'https://wlqgibttbggikhdfporr.supabase.co/functions/v1';
  var SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscWdpYnR0YmdnaWtoZGZwb3JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODU4OTksImV4cCI6MjA4ODU2MTg5OX0.lXv-5cR6ZkigZTou_y-oAXMV5BjH9Zhe4Gercc5rdbg';

  var _provider = null;
  var _wallet   = null;

  // ── UI state machine ───────────────────────────────────────────────────────
  function showState(id) {
    ['wgLoading', 'wgConnect', 'wgWrongNet', 'wgNotHolder'].forEach(function (s) {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
    document.getElementById('walletGate').style.display = 'flex';
  }

  function hideGate() {
    document.getElementById('walletGate').style.display = 'none';
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    showState('wgLoading');

    document.getElementById('wgConnectBtn').addEventListener('click', connect);
    document.getElementById('wgDisconnectBtn').addEventListener('click', disconnect);
    document.getElementById('wgSwitchBtn').addEventListener('click', switchNetwork);

    // Re-verify on every tab focus — never trust stale state
    window.addEventListener('focus', function () {
      if (_wallet && _provider) verifyHolder(_wallet);
    });

    // Listen for MetaMask account/chain changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', function (accounts) {
        if (!accounts || !accounts.length) { disconnect(); return; }
        _provider = new ethers.BrowserProvider(window.ethereum);
        _wallet   = ethers.getAddress(accounts[0]);
        verifyHolder(_wallet);
      });
      window.ethereum.on('chainChanged', function () {
        // Simplest safe approach — reload on chain switch
        window.location.reload();
      });
    }

    // Check if MetaMask is already unlocked with a saved wallet (no popup)
    var saved = null;
    try { saved = localStorage.getItem('gobWallet'); } catch (e) {}

    if (saved && window.ethereum) {
      try {
        // eth_accounts is passive — never triggers a popup
        var accounts = await window.ethereum.request({ method: 'eth_accounts' });
        var match    = accounts.find(function (a) {
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
      } catch (e) { /* MetaMask not available or locked — fall through */ }
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
        showState('wgConnect'); // user rejected MetaMask popup
      } else {
        console.error('[gate] connect failed', e);
        showState('wgConnect');
      }
    }
  }

  // ── On-chain verify + sign + session token ────────────────────────────────
  async function verifyHolder(wallet) {
    showState('wgLoading');
    try {
      // 1. balanceOf read — public call, safe client-side
      var contract = new ethers.Contract(CONTRACT, ABI, _provider);
      var balance  = await contract.balanceOf(wallet);

      if (balance < 1n) {
        showState('wgNotHolder');
        return;
      }

      // 2. Sign message — proves the user controls this wallet's private key
      //    This is what stops someone typing another address in the console.
      var signer = await _provider.getSigner();
      var nonce  = crypto.randomUUID();
      var msg    = 'Gobinos: verify wallet ownership.\nNonce: ' + nonce;

      var sig;
      try {
        sig = await signer.signMessage(msg);
      } catch (signErr) {
        if (signErr.code === 4001) {
          // User rejected signing — go back to connect, don't punish them
          disconnect();
          return;
        }
        throw signErr;
      }

      // 3. Issue session token — Edge Function verifies signature server-side
      var r = await fetch(FN_BASE + '/issue-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SB_KEY
        },
        body: JSON.stringify({
          wallet:    wallet.toLowerCase(),
          signature: sig,
          nonce:     nonce
        })
      });

      if (!r.ok) {
        var errData = await r.json().catch(function () { return {}; });
        throw new Error(errData.error || 'session request failed (' + r.status + ')');
      }

      var d = await r.json();
      if (!d.token) throw new Error('no token returned');

      // 4. Hand off wallet + token to game, then hide gate
      try { localStorage.setItem('gobWallet', wallet); } catch (e) {}
      _gob._setWalletAuth(wallet.toLowerCase(), d.token);
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

  // ── Disconnect ─────────────────────────────────────────────────────────────
  function disconnect() {
    _provider = null;
    _wallet   = null;
    try { localStorage.removeItem('gobWallet'); } catch (e) {}
    showState('wgConnect');
  }

  init();

  return { disconnect: disconnect };

})();
