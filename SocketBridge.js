// ========================================================
// ✅ Cardito SocketBridge.js (WebGL ↔ Server bridge)
// ========================================================

const SOCKET_URL = window.SOCKET_URL || "https://carditoserver.onrender.com";

// 🔹 decimals هر شبکه برای توکن پرداختی آن شبکه (یک توکن در هر chain)
const TOKEN_DECIMALS = {
  1: 6,     // Ethereum USDC
  56: 18,   // BNB USDT
  146: 6,   // Sonic stable
  137: 6,   // Polygon USDT
  8453: 6,  // Base USDC
  42161: 6  // Arbitrum USDC
};

// 🔹 کش تنظیمات پرداخت که از سرور می‌آید (treasury + TOKEN_MAP)
let CARDITO_PAYMENT_CFG = null;

async function loadPaymentConfig() {
  if (CARDITO_PAYMENT_CFG) return CARDITO_PAYMENT_CFG;

  try {
    const base = SOCKET_URL.replace(/\/$/, "");
    const res = await fetch(base + "/config/payments");
    const json = await res.json();

    if (!json.ok || !json.treasury || !json.tokens) {
      console.error("[SocketBridge] /config/payments invalid response", json);
      throw new Error("payment_config_invalid");
    }

    CARDITO_PAYMENT_CFG = json;
    console.log("[SocketBridge] Payment config loaded:", CARDITO_PAYMENT_CFG);
    return CARDITO_PAYMENT_CFG;
  } catch (err) {
    console.error("[SocketBridge] Failed to load /config/payments", err);
    throw err;
  }
}

// ========================================================
// 🧩 Helper - ارسال پیام به یونیتی
// ========================================================
function sendToUnity(event, data) {
  try {
    if (typeof sendMessage === "function") {
      const json = JSON.stringify(data || {});
      sendMessage("SocketManager", "OnSocketMessage", `${event}|${json}`);
    } else {
      console.warn("[SocketBridge] ⚠️ Unity bridge not ready yet.");
    }
  } catch (err) {
    console.error("[SocketBridge] ❌ sendToUnity error:", err);
  }
}

// ========================================================
// 🌐 اتصال Socket.IO
// ========================================================
window.CarditoSocket_Init = function (serverUrl) {
  console.log("[SocketBridge] Init called (JS); socket is created by .jslib. No-op here.");
  return;
};

// ========================================================
// ✉️ ارسال داده از یونیتی به سرور
// ========================================================
window.CarditoSocket_Emit = function (eventName, jsonData) {
  try {
    if (!window.CarditoSocket) {
      console.warn("[SocketBridge] ❌ Socket not initialized!");
      return;
    }
    const data = JSON.parse(jsonData || "{}");
    console.log("[SocketBridge] 📤 Emit:", eventName, data);
    window.CarditoSocket.emit(eventName, data);
  } catch (err) {
    console.error("[SocketBridge] Emit error:", err);
  }
};

// ========================================================
// 🔚 بستن اتصال
// ========================================================
window.CarditoSocket_Close = function () {
  if (window.CarditoSocket) {
    console.log("[SocketBridge] 🔌 Closing connection...");
    window.CarditoSocket.disconnect();
    window.CarditoSocket = null;
  }
};

// ========================================================
// 🪙 Web3 برای متامسک (فقط مرورگر)
// ========================================================
window.Web3_GetAddress = async function (gameObjectName) {
  try {
    const provider = await getEip1193Provider();

    // درخواست آدرس از injected یا WalletConnect
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = accounts[0];

    console.log("[Web3Bridge] ✅ Address:", address);

    // ➜ کال‌بک درست: RegisterManager.OnWeb3Address
    if (typeof sendMessage === "function") {
      sendMessage(gameObjectName, "OnWeb3Address", address);
    }
  } catch (err) {
    console.error("[Web3Bridge] GetAddress error:", err);

    // ➜ کال‌بک خطا: RegisterManager.OnWeb3Error
    if (typeof sendMessage === "function") {
      const msg = err?.message || "Wallet connection failed";
      sendMessage(gameObjectName, "OnWeb3Error", msg);
    }
  }
};

window.Web3_SignMessage = async function (gameObjectName, msg) {
  try {
    const provider = await getEip1193Provider();

    // 1) آدرس فعال را از همان provider بگیر (MetaMask یا WalletConnect)
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const from = accounts[0];
    
    // 2) امضا با همان provider (نه فقط window.ethereum)
    const signature = await provider.request({
      method: "personal_sign",
      params: [msg, from],
    });

    console.log("[Web3Bridge] ✍️ Signed:", signature);

    // ➜ کال‌بک درست برای RegisterManager.OnWeb3Signature
    if (typeof sendMessage === "function") {
      sendMessage(gameObjectName, "OnWeb3Signature", signature);
    }
  } catch (err) {
    console.error("[Web3Bridge] SignMessage error:", err);

    // ➜ کال‌بک درست برای RegisterManager.OnWeb3Error
    if (typeof sendMessage === "function") {
      const msg = err && err.message ? err.message : String(err);
      sendMessage(gameObjectName, "OnWeb3Error", msg);
    }
  }
};

// ---- Wallet Sync from Unity ----
window.UnityActiveWallet = null;

window.SetUnityActiveWallet = function(addr) {
  console.log("[Web3Bridge] UnityActiveWallet set to:", addr);
  window.UnityActiveWallet = (addr || "").toLowerCase();
};

window.Web3Bridge = {};

// ---------- getEip1193Provider ----------
async function getEip1193Provider(chainId) {
  const hasEthereum = typeof window.ethereum !== "undefined";
  if (hasEthereum) {
    return window.ethereum;
  }
  const WC = window.WalletConnectProvider || window.WalletConnectEthereumProvider
           || globalThis.WalletConnectEthereumProvider || globalThis["@walletconnect/ethereum-provider"]?.EthereumProvider;
  if (!WC) {
    throw new Error("No Web3 provider found");
  }
  const wc = await WC.init({
    projectId: window.CARDITO_WC_PROJECT_ID,
    chains: [parseInt(chainId, 10)],
    optionalChains: [parseInt(chainId, 10)],
    showQrModal: true,
    enableMobileLinks: true,
    metadata: {
      name: "Cardito",
      description: "Cardito Payment",
      url: window.location.origin,
      icons: ["https://cardito.app/logo.png"]
    }
  });
  await wc.connect();
  // 🔥 Fix for Mobile Chrome WC — wait until namespace accounts become available
  let tries = 0;
  while (tries < 10) {
    try {
      const sess = wc.session || wc._client?.session || null;
      const accounts =
        sess?.namespaces?.eip155?.accounts ||
        sess?.state?.accounts ||
        null;

      if (accounts && accounts.length > 0) break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
    tries++;
  }
  return wc;
}

// ---------- PayStable ----------
window.Web3Bridge.PayStable = async function (sku, amount, tokenSymbol, chainId) {
  try {
    const eth = window.ethers;
    if (!eth) {
      console.error("[PayStable] ✖ ethers not found");
      sendMessage("StoreManager", "ShowStoreError", "Blockchain library missing");
      return;
    }

    const cid = parseInt(chainId || 1, 10);
    const sym = String(tokenSymbol || "USDC").toUpperCase();
    const amtStr = String(amount);

    const providerRaw = await getEip1193Provider(cid);

    // ---- If injected provider (MetaMask/Coinbase), enforce chain switch ----
    const isInjected =
      typeof window.ethereum !== "undefined" &&
      providerRaw === window.ethereum;

    if (isInjected) {
      const requiredHex = "0x" + cid.toString(16);
      try {
        const current = await providerRaw.request({ method: "eth_chainId" });
        if (current.toLowerCase() !== requiredHex.toLowerCase()) {
          console.log("[PayStable] Injected wallet → switching chain", requiredHex);

          await providerRaw.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: requiredHex }]
          });
          await providerRaw.request({ method: "eth_chainId" });
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (switchErr) {
        console.warn("[PayStable] switch failed → letting wallet handle", switchErr.message);
      }
    }

    const provider = new eth.providers.Web3Provider(providerRaw);
    const signer = provider.getSigner();
    const wallet = (await signer.getAddress()).toLowerCase();

    const payCfg = await loadPaymentConfig();
    const mapping = payCfg.tokens[String(cid)];
    if (!mapping || !mapping[sym]) {
      sendMessage("StoreManager", "ShowStoreError", "Token not supported on chain");
      return;
    }
    const tokenAddr = mapping[sym];
    const decimals = TOKEN_DECIMALS[cid] || 6;
    const amountWei = eth.utils.parseUnits(amtStr, decimals);
    const treasury = (payCfg.treasury || "").toLowerCase();
    if (!treasury) {
      sendMessage("StoreManager", "ShowStoreError", "Treasury address config missing");
      return;
    }

    const iface = new eth.utils.Interface([
      "function transfer(address to, uint256 amount)"
    ]);
    const data = iface.encodeFunctionData("transfer", [treasury, amountWei]);

    const txParams = {
      from: wallet,
      to: tokenAddr,
      data: data,
      value: "0x0"
    };

    console.log("[PayStable] Sending raw tx:", txParams);

    const txHash = await providerRaw.request({
      method: "eth_sendTransaction",
      params: [txParams]
    });

    console.log("[PayStable] TX hash:", txHash);
    sendMessage("StoreManager", "OnWebGLTxSubmitted", JSON.stringify({
      sku, hash: txHash, chainId: cid, token: sym
    }));

  } catch (err) {
    console.error("[PayStable] ERROR:", err);
    const raw = (err && err.message) || "";
    let msg = "Payment failed";
    if (raw.toLowerCase().includes("insufficient")) msg = "Not enough balance";
    if (raw.toLowerCase().includes("rejected")) msg = "User rejected";
    sendMessage("StoreManager", "ShowStoreError", msg);
  }
};
