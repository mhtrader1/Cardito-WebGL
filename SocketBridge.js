// ============================================================
//  SocketBridge.js – Stable bridge for Unity WebGL (Cardito)
// ============================================================
console.log("[SocketBridge] ✅ Script loaded successfully in browser context");
if (!window.CarditoSocket_Init) {
  // ---- readiness flags ----
  let unityReady = false;
  let socketReady = false;
  let pendingMsgs = []; // {obj, method, msg}

  function bufferOrSend(objName, methodName, msg) {
    if (unityReady && window.unityInstance && window.unityInstance.SendMessage) {
      try { window.unityInstance.SendMessage(objName, methodName, msg); }
      catch(e){ console.error("[SocketBridge] SendMessage failed:", e, {objName, methodName, msg}); }
    } else {
      pendingMsgs.push({obj: objName, method: methodName, msg});
      console.warn("[SocketBridge] Unity not ready → buffered:", msg);
    }
  }

  function flushBuffer() {
    if (!(unityReady && window.unityInstance && window.unityInstance.SendMessage)) return;
    if (pendingMsgs.length === 0) return;
    const list = pendingMsgs.splice(0);
    console.log(`[SocketBridge] Flushing ${list.length} buffered messages to Unity`);
    for (const it of list) {
      try { window.unityInstance.SendMessage(it.obj, it.method, it.msg); }
      catch(e){ console.error("[SocketBridge] Flush failed:", e, it); }
    }
  }

  // Called by index.html after unityInstance is created
  window.CarditoUnityReady = function() {
    unityReady = true;
    console.log("[SocketBridge] Unity ready");
    flushBuffer();
  };

  window.CarditoSocket_Init = function (socketUrl) {
    console.log("[SocketBridge] Connecting to:", socketUrl);
    const socket = io(socketUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    });
    window.carditoSocket = socket;

    // Forward only lobby-critical events to WaitingRoomManager
    const lobbyEvents = ["playerListUpdate","countdown","startGame","errorToast"];

    lobbyEvents.forEach(evt => {
      socket.on(evt, (payload) => {
        const str = `${evt}|${JSON.stringify(payload || {})}`;
        console.log(`[SocketBridge] on(${evt}) →`, str);
        bufferOrSend("WaitingRoomManager", "OnSocketMessage", str);
        bufferOrSend("SocketManager",     "OnSocketMessage", str); // کمک به سازگاری
        flushBuffer();
      });
    });

    // Log every incoming event to verify delivery
    socket.onAny((event, data) => {
      const str = `${event}|${JSON.stringify(data || {})}`;
      console.log("[SocketBridge] onAny:", str);
      if (!lobbyEvents.includes(event)) {
        bufferOrSend("SocketManager", "OnSocketMessage", str);
        flushBuffer();
      }
    });

    // Emit API from Unity
    window.CarditoSocket_Emit = function(eventName, jsonPayload) {
      try {
        const payload = jsonPayload ? JSON.parse(jsonPayload) : {};
        console.log("[SocketBridge] Emit:", eventName, payload);
        socket.emit(eventName, payload);
      } catch(e) {
        console.error("[SocketBridge] Emit failed:", e, eventName, jsonPayload);
      }
    };

    window.CarditoSocket_Close = function() {
      try { socket.close(); } catch {}
    };

    // Connection lifecycle
    socket.on("connect", () => {
      socketReady = true;
      console.log("[SocketBridge] Connected:", socket.id);
      bufferOrSend("SocketManager", "OnSocketMessage", "connected|{}");
      flushBuffer();
      // ✅ تست پینگ فقط وقتی وصل شد:
      console.log("[SocketBridge] sending pingFromClient...");
      socket.emit("pingFromClient", { msg: "hi from WebGL" });
    });

    socket.on("pongFromServer", (data) => {
      console.log("[SocketBridge] got pongFromServer:", data);
    });

    socket.on("disconnect", (reason) => {
      socketReady = false;
      console.warn("[SocketBridge] Disconnected:", reason);
      bufferOrSend("SocketManager", "OnSocketMessage", "disconnected|{}");
    });

    socket.on("connect_error", (err) => {
      console.error("[SocketBridge] connect_error:", err?.message || err);
      bufferOrSend("SocketManager", "OnSocketMessage", "connect_error|{}");
    });

    socket.on("reconnect_attempt", (n) => {
      console.warn("[SocketBridge] reconnect_attempt:", n);
      bufferOrSend("SocketManager", "OnSocketMessage", `reconnect_attempt|{"count":${n}}`);
    });

    socket.on("reconnect_failed", () => {
      console.error("[SocketBridge] reconnect_failed");
      bufferOrSend("SocketManager", "OnSocketMessage", "reconnect_failed|{}");
    });

    console.log("[SocketBridge] Init done");
  }
}
