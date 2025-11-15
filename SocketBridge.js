// ========================================================
// ✅ Cardito SocketBridge.js (WebGL ↔ Server bridge)
// ========================================================

const SOCKET_URL = window.SOCKET_URL || "https://api.cardito.app";

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
// -----------------------------------------------
// getEip1193Provider  (MetaMask OR WalletConnect)
// -----------------------------------------------
async function getEip1193Provider(chainId) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const hasInjected = typeof window.ethereum !== "undefined";

  // 1) اگر کیف‌پول اینجکت شده (MetaMask, Trust, Rabby ...) هست، همان را استفاده کن
  if (!isMobile && hasInjected) {
    console.log("[Web3Bridge] Using injected provider (desktop)");
    return window.ethereum;
  }

  // 2) اگر روی موبایل هستیم و WalletConnect Provider لود شده
  // WalletConnect (only when no injected wallet AND mobile)
  if (isMobile && window.WalletConnectEthereumProvider) {

      const EthereumProvider = window.WalletConnectEthereumProvider;
      const projectId = window.CARDITO_WC_PROJECT_ID || "7a03ac67d724cd7a88e72da1ec30c7f6";

      console.log("[Web3Bridge] Using WalletConnect v2 provider with projectId:", projectId);

      const cid = parseInt(chainId || 1, 10); // chainId from PayStable or registration

      // Initialize WC provider
      const wc = await EthereumProvider.init({
          projectId,
          chains: [cid],      // ← actual chain required
          optionalChains: [cid],
          showQrModal: false  // MUST be false on mobile → enables deep link
      });

      return wc;
  }

  // 3) هیچ providerای در دسترس نیست
  throw new Error("No Web3 provider available (MetaMask or WalletConnect)");
}

// ========================================================
// 💰 پرداخت واقعی استیبل‌کوین برای WebGL (MetaMask / Wallet Browser)
// ========================================================
window.Web3Bridge.PayStable = async function (sku, amount, tokenSymbol, chainId) {
  try {
    const ethLib = (typeof window !== "undefined" && window.ethers)
      || (typeof globalThis !== "undefined" && globalThis.ethers);

    if (!ethLib) {
      console.error("[Web3Bridge] ❌ ethers.js not loaded (window.ethers/globalThis.ethers is missing)");
      if (typeof sendMessage === "function") {
        sendMessage(
          "StoreManager",
          "ShowStoreError",
          "Web3 library (ethers.js) is not loaded. Please check index.html scripts."
        );
      }
      return;
    }

    const cid = parseInt(chainId || 1, 10);
    const sym = String(tokenSymbol || "USDC").toUpperCase();
    const amtStr = String(amount);
    
    const eip1193 = await getEip1193Provider(cid);
    const provider = new ethLib.providers.Web3Provider(eip1193);
    const signer = provider.getSigner();

    // --- Wallet mismatch protection ---
    const currentMM = (await signer.getAddress()).toLowerCase();
    const unityWallet = (window.UnityActiveWallet || "").toLowerCase();

    if (unityWallet && currentMM !== unityWallet) {
        console.error("[Web3Bridge] ❌ Wallet mismatch:", { currentMM, unityWallet });
        if (typeof sendMessage === "function") {
            sendMessage("StoreManager", "ShowStoreError", "Your connected wallet does not match the active wallet.");
        }
        return;
    }

    console.log("[Web3Bridge] Web3_PayStablecoin called:", { sku, amtStr, sym, cid });

    // -------------------------------
    // گرفتن آدرس توکن و خزانه از سرور (منبع مرکزی: server.js)
    // -------------------------------
    const payCfg = await loadPaymentConfig();
    const chainTokens = payCfg.tokens[String(cid)];

    if (!chainTokens || !chainTokens[sym]) {
      console.error("[Web3Bridge] ❌ Token not supported for this chain:", cid, sym);
      if (typeof sendMessage === "function") {
        sendMessage("StoreManager", "ShowStoreError", "Token not supported on this chain.");
      }
      return;
    }

    // روی سرور TOKEN_MAP[chainId][symbol] معمولاً خود آدرس است (string)
    const tokenAddress = String(chainTokens[sym]).toLowerCase();
    const decimals = TOKEN_DECIMALS[cid] ?? 6;

    // -------------------------------
    // بررسی اینکه شبکه فعلی کیف پول == chainId مورد نیاز است
    // -------------------------------
    const currentChain = await provider.send("eth_chainId", []);
    const hexChain = "0x" + cid.toString(16);

    if (currentChain.toLowerCase() !== hexChain.toLowerCase()) {
      console.warn("[Web3Bridge] Switching chain:", currentChain, "→", hexChain);
      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId: hexChain }]);
      } catch (switchErr) {
        console.error("[Web3Bridge] Cannot switch chain", switchErr);
        sendMessage("StoreManager", "ShowStoreError", "Please switch network in your wallet.");
        return;
      }
    }

    // -------------------------------
    // ساخت مقدار پرداخت با توجه به decimals
    // -------------------------------
    const amountWei = ethLib.utils.parseUnits(amtStr, decimals);

    // -------------------------------
    // آدرس خزانه — از سرور (TREASURY_ADDRESS) می‌آید
    // -------------------------------
    const treasury = (payCfg.treasury || "").toLowerCase();
    if (!treasury) {
      console.error("[Web3Bridge] ❌ Missing treasury address in payment config");
      if (typeof sendMessage === "function") {
        sendMessage("StoreManager", "ShowStoreError", "Payment configuration missing treasury address.");
      }
      return;
    }

    console.log("[Web3Bridge] Sending stablecoin payment:", {
      token: tokenAddress,
      amount: amountWei.toString(),
      treasury
    });

    // -------------------------------
    // قالب ERC20 استاندارد
    // -------------------------------
    const ERC20_ABI = [
      "function transfer(address to, uint256 amount) public returns (bool)"
    ];

    const tokenContract = new ethLib.Contract(tokenAddress, ERC20_ABI, signer);

    // -------------------------------
    // ارسال تراکنش
    // -------------------------------
    const tx = await tokenContract.transfer(treasury, amountWei);
    console.log("[Web3Bridge] TX sent:", tx.hash);

    // -------------------------------
    // ارسال txHash به Unity
    // -------------------------------
    const payload = {
      sku,
      hash: tx.hash,
      chainId: cid,
      token: sym
    };

    sendMessage("StoreManager", "OnWebGLTxSubmitted", JSON.stringify(payload));

  } catch (err) {
      console.error("[Web3Bridge] Web3_PayStablecoin ERROR:", err);

      let userMessage = "Payment failed. Please try again.";

      const raw = err?.message || "";

      if (raw.includes("underlying network changed")) {
          userMessage = "Your wallet switched networks. Please switch back and try again.";
      }
      else if (raw.includes("insufficient") || raw.includes("exceeds balance")) {
          userMessage = "Not enough balance for this purchase.";
      }
      else if (raw.includes("user rejected")) {
          userMessage = "Transaction was rejected.";
      }
      else if (raw.includes("network") || raw.includes("chain")) {
          userMessage = "Network mismatch. Please change your network in wallet.";
      }

      if (typeof sendMessage === "function") {
          sendMessage("StoreManager", "ShowStoreError", userMessage);
      }
      return;
    }
};
