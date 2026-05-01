<script>
// ===============================
// ① 設定
// ===============================
var DUPLICATE_MS = 1500;
var CAMERA_FREEZE_SEC = 1.5;
var QR_RE = /^\d{1,20}$/;
var CALL_RE = /^[A-Za-z]\d+$/;
var PH_DEFAULT = 'QRコードをスキャンしてください';
var PH_MANUAL = '呼出番号を入力してください。（例：S001、M001）';
var PH_OFFLINE = '呼出番号を手入力してください。（例：S001、M001）';

// ===============================
// ② 状態管理
// ===============================
var state = {
  orders: [
    {orderId:'1', callNumber:'S001'},
    {orderId:'2', callNumber:'S002'},
    {orderId:'3', callNumber:'M001'},
    {orderId:'4', callNumber:'M002'},
    {orderId:'5', callNumber:'S003'},
    {orderId:'6', callNumber:'M003'},
    {orderId:'7', callNumber:'S004'},
    {orderId:'8', callNumber:'M004'},
    {orderId:'9', callNumber:'S005'},
    {orderId:'10', callNumber:'M005'},
    {orderId:'11', callNumber:'S006'},
    {orderId:'12', callNumber:'M006'},
    {orderId:'13', callNumber:'S007'},
    {orderId:'14', callNumber:'M007'},
    {orderId:'15', callNumber:'S008'},
    {orderId:'16', callNumber:'M008'},
    {orderId:'17', callNumber:'S009'},
    {orderId:'18', callNumber:'M009'},
    {orderId:'19', callNumber:'S010'},
    {orderId:'20', callNumber:'M010'}
  ],
  doneOrders: [],
  errorItems: [],
  offlineQueue: [],
  recentScans: {},
  processing: false,
  isOnline: navigator.onLine,
  isManualMode: false,
  currentTab: 'pending'
};
// stateの各プロパティへの参照（既存コードとの互換性）
var orders = state.orders;
var doneOrders = state.doneOrders;
var errorItems = state.errorItems;
var offlineQueue = state.offlineQueue;
var recentScans = state.recentScans;
var processing = state.processing;
var isOnline = state.isOnline;
var isManualMode = state.isManualMode;
var currentTab = state.currentTab;
// カメラ状態（state外で管理）
var html5QrCode=null, isCameraOn=false, cameraFreezing=false, cameraFreezeTimer=null, cameraScanning=false, scannerObserver=null;

var RETRYABLE_CODES = [600, 900, 'network'];
var ERROR_MSGS = {
  300: '該当のIDが存在しません。',
  500: 'すでに処理済みの注文です',
  501: '返品済みの注文です',
  600: '読取エラー。再度スキャンしてください',
  900: 'サーバーに接続できません。しばらく待ってから再試行してください',
  network: '通信が途切れました。再試行してください'
};

// ===============================================
// WebSocket実装（本番組込待ち）
// ===============================================
// API担当者と以下を確認・設定してください
// ① WS_URL: WebSocketのエンドポイントURL
// ② 認証方法（トークン等）
// ③ イベント種別とメッセージ形式
// ===============================================

var WS_CONFIG = {
  // ★ API担当者と確認して設定してください
  // URL: 'wss://api.xxx.jp/ws',
  // TOKEN: 'your-auth-token',
  RECONNECT_INTERVAL: 5000,  // 再接続間隔（ミリ秒）
  MAX_RECONNECT: 10           // 最大再接続回数
};

var wsInstance = null;
var wsReconnectCount = 0;
var wsReconnectTimer = null;
var wsEnabled = false; // ★ 本番組込時に true に変更してください

// WebSocket接続状態をバッジに表示
function updateWsBadge(status) {
  var badge = document.getElementById('wsBadge');
  if(!badge) return;
  var labels = { connecting: '接続中...', connected: 'リアルタイム受信中', disconnected: 'WS切断中' };
  badge.textContent = labels[status] || '';
  badge.className = 'ws-badge show ' + status;
  if(status === 'disconnected') {
    // 切断時は5秒後に非表示
    setTimeout(function(){ badge.className = 'ws-badge'; }, 5000);
  }
}

// WebSocket接続
function connectWebSocket() {
  if(!wsEnabled) return; // 無効時は接続しない

  // ========================================
  // ★ 本番組込時: 以下のコメントを外して
  //    WS_CONFIG.URL と認証情報を設定してください
  // ========================================
  /*
  if(!WS_CONFIG.URL) {
    console.warn('WebSocket URL未設定');
    return;
  }

  updateWsBadge('connecting');

  wsInstance = new WebSocket(WS_CONFIG.URL);
  // 認証トークンが必要な場合はURL末尾に付与
  // wsInstance = new WebSocket(WS_CONFIG.URL + '?token=' + WS_CONFIG.TOKEN);

  wsInstance.onopen = function() {
    console.log('WebSocket接続成功');
    wsReconnectCount = 0;
    clearTimeout(wsReconnectTimer);
    updateWsBadge('connected');
  };

  wsInstance.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch(e) {
      console.error('WebSocketメッセージ解析エラー:', e);
    }
  };

  wsInstance.onclose = function() {
    console.log('WebSocket切断');
    updateWsBadge('disconnected');
    wsInstance = null;
    // 自動再接続
    if(wsReconnectCount < WS_CONFIG.MAX_RECONNECT) {
      wsReconnectCount++;
      console.log('再接続試行: ' + wsReconnectCount + '回目');
      wsReconnectTimer = setTimeout(connectWebSocket, WS_CONFIG.RECONNECT_INTERVAL);
    } else {
      console.warn('WebSocket再接続上限に達しました');
      showHeaderToast('リアルタイム受信が切断されました。更新ボタンで手動更新してください。', 'info');
    }
  };

  wsInstance.onerror = function(e) {
    console.error('WebSocketエラー:', e);
  };
  */
}

// WebSocketメッセージ処理
// ========================================
// ★ 本番組込時: API担当者とメッセージ形式を確認して
//    以下のイベント種別・データ構造を合わせてください
// ========================================
function handleWsMessage(data) {
  /*
  switch(data.type) {

    // 新しいオーダーが追加された
    case 'ORDER_ADDED':
      // 例: data.order = { orderId: '123', callNumber: 'S001' }
      if(data.order && !state.orders.find(function(o){ return o.orderId === data.order.orderId; })) {
        state.orders.push({ orderId: data.order.orderId, callNumber: data.order.callNumber });
        renderOrders();
        showHeaderToast('新しいオーダーが追加されました: ' + data.order.callNumber, 'info');
      }
      break;

    // オーダーが削除された
    case 'ORDER_REMOVED':
      // 例: data.orderId = '123'
      // 参照を壊さないようspliceで削除
      for(var oi=state.orders.length-1; oi>=0; oi--) {
        if(state.orders[oi].orderId === data.orderId) { state.orders.splice(oi,1); }
      }
      renderOrders();
      break;

    // オーダー一覧をまとめて更新
    case 'ORDERS_REFRESHED':
      // 例: data.orders = [{ orderId: '1', callNumber: 'S001' }, ...]
      if(data.orders) {
        // 参照を壊さないよう中身だけ入れ替える
        state.orders.length = 0;
        data.orders.forEach(function(o){ state.orders.push(o); });
        renderOrders();
      }
      break;

    default:
      console.log('未対応のWebSocketイベント:', data.type);
  }
  */
}

// WebSocket切断
function disconnectWebSocket() {
  clearTimeout(wsReconnectTimer);
  if(wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
}

// -----------------------------------------------
// localStorageエラー管理
// 当日分のみ保存・読込・削除
// -----------------------------------------------
var LS_KEY = 'barcode_order_app_errors';

function todayStr() {
  var n=new Date();
  var p=function(v){return String(v).padStart(2,'0');};
  return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
}

function saveErrorsToStorage() {
  try {
    var data = { date: todayStr(), errors: state.errorItems };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch(e) { console.error('localStorage保存エラー:', e); }
}

function loadErrorsFromStorage() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    var data = JSON.parse(raw);
    // 当日分のみ読み込む（前日以前は無視して削除）
    if(data.date === todayStr()) {
      // 配列の参照を壊さないよう中身だけ入れ替える
      state.errorItems.length = 0;
      (data.errors || []).forEach(function(e){ state.errorItems.push(e); });
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch(e) {
    console.error('localStorage読込エラー:', e);
    localStorage.removeItem(LS_KEY);
  }
}

// -----------------------------------------------
// 日時
// -----------------------------------------------
function now() {
  var n=new Date(); var p=function(v){return String(v).padStart(2,'0');};
  return p(n.getHours())+':'+p(n.getMinutes())+':'+p(n.getSeconds());
}
function updateDatetime() {
  var n=new Date(); var p=function(v){return String(v).padStart(2,'0');};
  document.getElementById('datetime').textContent =
    n.getFullYear()+'/'+p(n.getMonth()+1)+'/'+p(n.getDate())+'  '+p(n.getHours())+':'+p(n.getMinutes())+':'+p(n.getSeconds());
}

// ===============================
// ④ イベント
// ===============================
function toggleCamera() {
  if(isCameraOn) {
    stopCamera();
    isManualMode = true;
    applyModeUI();
  } else {
    isManualMode = false;
    startCamera();
  }
}

// -----------------------------------------------
// QRコードフォーカス枠の描画
// -----------------------------------------------
var qrFocusTimer = null;

function drawFocusFrame(location, color) {
  var canvas = document.getElementById('qrFocusCanvas');
  if(!canvas || !location) return;
  var video = document.querySelector('#reader video');
  if(!video) return;

  // CanvasのCSSサイズをvideo表示サイズに合わせる
  var displayW = video.offsetWidth;
  var displayH = video.offsetHeight;
  canvas.style.width = displayW + 'px';
  canvas.style.height = displayH + 'px';
  canvas.width = displayW;
  canvas.height = displayH;

  // videoの実解像度と表示サイズのスケール比
  var scaleX = displayW / (video.videoWidth || displayW);
  var scaleY = displayH / (video.videoHeight || displayH);

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 四隅座標をスケール変換
  var points = [
    {x: location.topLeftCorner.x * scaleX,     y: location.topLeftCorner.y * scaleY},
    {x: location.topRightCorner.x * scaleX,    y: location.topRightCorner.y * scaleY},
    {x: location.bottomRightCorner.x * scaleX, y: location.bottomRightCorner.y * scaleY},
    {x: location.bottomLeftCorner.x * scaleX,  y: location.bottomLeftCorner.y * scaleY}
  ];

  var frameColor = color || '#ffffff';
  var cornerLen = 24;
  var lineW = 4;

  ctx.strokeStyle = frameColor;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'square';
  ctx.shadowColor = frameColor;
  ctx.shadowBlur = 6;

  // 四隅のコーナーマークのみ描画（画像のイメージ通り）
  var corners = [
    {p: points[0], h: points[1], v: points[3]}, // 左上
    {p: points[1], h: points[0], v: points[2]}, // 右上
    {p: points[2], h: points[3], v: points[1]}, // 右下
    {p: points[3], h: points[2], v: points[0]}  // 左下
  ];

  corners.forEach(function(c) {
    var hLen = Math.hypot(c.h.x - c.p.x, c.h.y - c.p.y);
    var vLen = Math.hypot(c.v.x - c.p.x, c.v.y - c.p.y);
    var hx = (c.h.x - c.p.x) / hLen * cornerLen;
    var hy = (c.h.y - c.p.y) / hLen * cornerLen;
    var vx = (c.v.x - c.p.x) / vLen * cornerLen;
    var vy = (c.v.y - c.p.y) / vLen * cornerLen;
    ctx.beginPath();
    ctx.moveTo(c.p.x + hx, c.p.y + hy);
    ctx.lineTo(c.p.x, c.p.y);
    ctx.lineTo(c.p.x + vx, c.p.y + vy);
    ctx.stroke();
  });

  // フリーズ中でなければ0.5秒後に消す
  clearTimeout(qrFocusTimer);
  if(!cameraFreezing) {
    qrFocusTimer = setTimeout(function() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 500);
  }
}

function clearFocusFrame() {
  var canvas = document.getElementById('qrFocusCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function hideScannerPausedText() {
  var reader = document.getElementById('reader');
  if(!reader) return;
  // テキストノードを深い階層まで全部見る
  var walker = document.createTreeWalker(
    reader,
    NodeFilter.SHOW_TEXT,
    null
  );
  var removeNodes = [];
  var node;
  while(node = walker.nextNode()) {
    var text = node.textContent || '';
    var normalized = text.replace(/\s+/g, '').toLowerCase();
    if(normalized.indexOf('scannerpaused') >= 0) {
      removeNodes.push(node);
    }
  }
  removeNodes.forEach(function(n) { n.textContent = ''; });
  // 要素側にも出る場合の保険
  var els = reader.querySelectorAll('span, div');
  els.forEach(function(el) {
    var text = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
    if(text === 'scannerpaused') {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
    }
  });
}
// ===============================
// ⑤ カメラ制御
// ===============================
function startCamera() {
  // 多重起動防止
  if(cameraScanning) return;
  // カメラON時: 手入力ボタンをOFFに・入力欄を非表示
  document.getElementById('manualToggleBtn').classList.remove('on');
  document.getElementById('scanArea').classList.add('hidden');
  isCameraOn = true;
  cameraScanning = true;

  try {
    html5QrCode = new Html5Qrcode('reader');
  } catch(e) {
    console.error('Html5Qrcode初期化エラー:', e);
    isCameraOn = false;
    cameraScanning = false;
    isManualMode = true;
    applyModeUI();
    showHeaderToast('カメラが使用できません。手入力モードに切り替えました。', 'info');
    return;
  }
  // スキャン領域をカメラ全体に設定（オーバーレイはCSS非表示）
  var wrapper = document.getElementById('cameraArea');
  // サイズ計算前にcameraAreaを表示してoffsetWidth/Heightを正しく取得
  wrapper.classList.add('show');
  var wrapperW = wrapper ? wrapper.offsetWidth : 320;
  var wrapperH = wrapper ? wrapper.offsetHeight : 260;
  var qrW = Math.max(wrapperW, 100);
  var qrH = Math.max(wrapperH, 100);
  // Scanner pausedテキストをMutationObserverで監視・削除
  var scannerPausedTimer = null;
  if(scannerObserver) { scannerObserver.disconnect(); scannerObserver = null; }
  scannerObserver = new MutationObserver(function() {
    hideScannerPausedText();
  });
  var readerEl = document.getElementById('reader');
  if(readerEl) {
    scannerObserver.observe(readerEl, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  hideScannerPausedText();

  // PCでは'environment'が使えない場合があるため'user'にフォールバック
  var cameraConfig = { facingMode: 'environment' };
  html5QrCode.start(
    cameraConfig,
    {fps: 10, qrbox: {width: qrW, height: qrH}},
    function(decodedText, decodedResult) {
      // Scanner pausedテキストを削除
      var scanRegion = document.getElementById('reader__scan_region');
      if(scanRegion) {
        var spans = scanRegion.getElementsByTagName('span');
        for(var i=0; i<spans.length; i++) { spans[i].style.display='none'; }
        var imgs = scanRegion.getElementsByTagName('img');
        for(var i=0; i<imgs.length; i++) { imgs[i].style.display='none'; }
      }
      // QRコード検出時にコーナーマークを表示
      var location = null;
      if(decodedResult) {
        if(decodedResult.result && decodedResult.result.location) {
          location = decodedResult.result.location;
        } else if(decodedResult.location) {
          location = decodedResult.location;
        }
      }
      if(location) drawFocusFrame(location, '#ffffff');
      onScanComplete(decodedText);
    },
    function() {}
  ).then(function() {
    // カメラ起動成功後にcameraAreaを表示
    document.getElementById('cameraArea').classList.add('show');
    document.getElementById('cameraBtnHeader').textContent = 'カメラ';
    document.getElementById('cameraBtnHeader').classList.add('on');
  }).catch(function() {
    // environmentが失敗した場合、userモードで再試行（PC向け）
    html5QrCode.start(
      {facingMode: 'user'},
      {fps: 10, qrbox: {width: qrW, height: qrH}},
      function(decodedText, decodedResult) {
        var location = null;
        if(decodedResult) {
          if(decodedResult.result && decodedResult.result.location) location = decodedResult.result.location;
          else if(decodedResult.location) location = decodedResult.location;
        }
        if(location) drawFocusFrame(location, '#ffffff');
        onScanComplete(decodedText);
      },
      function() {}
    ).then(function() {
      document.getElementById('cameraArea').classList.add('show');
      document.getElementById('cameraBtnHeader').textContent = 'カメラ';
      document.getElementById('cameraBtnHeader').classList.add('on');
    }).catch(function() {
      if(scannerObserver) scannerObserver.disconnect();
      document.getElementById('cameraArea').classList.remove('show');
      isCameraOn = false;
      cameraScanning = false;
      isManualMode = true;
      applyModeUI();
      showHeaderToast('カメラが使用できません。手入力モードに切り替えました。', 'info');
    });
  });
}

function stopCamera() {
  // 安全停止: stop()→clear()を順番に実行
  if(html5QrCode && isCameraOn) {
    html5QrCode.stop().then(function(){
      html5QrCode.clear();
      html5QrCode = null;
    }).catch(function(e){ console.error('カメラ停止エラー:', e); });
  }
  document.getElementById('cameraArea').classList.remove('show');
  document.getElementById('cameraBtnHeader').textContent = 'カメラ';
  document.getElementById('cameraBtnHeader').classList.remove('on');
  isCameraOn = false;
  cameraScanning = false;
  if(typeof scannerPausedTimer !== 'undefined') clearInterval(scannerPausedTimer);
  if(typeof scannerObserver !== 'undefined' && scannerObserver) { scannerObserver.disconnect(); scannerObserver = null; }
  cameraFreezing = false;
  clearTimeout(cameraFreezeTimer);
  clearTimeout(qrFocusTimer);
  clearFocusFrame();
  document.getElementById('cameraOverlay').className = 'camera-overlay';
}

function freezeCamera(type, msg) {
  if(!isCameraOn) return;
  cameraFreezing = true;
  var overlay = document.getElementById('cameraOverlay');
  var icons = {success:'✅', error:'❌', warning:'⚠️'};
  overlay.className = 'camera-overlay show ' + type;
  document.getElementById('cameraOverlayIcon').textContent = icons[type] || '';
  document.getElementById('cameraOverlayMsg').textContent = msg;
  clearTimeout(cameraFreezeTimer);
  cameraFreezeTimer = setTimeout(function() {
    document.getElementById('cameraOverlay').className = 'camera-overlay';
    cameraFreezing = false;
    clearFocusFrame();
  }, CAMERA_FREEZE_SEC * 1000);
}

// -----------------------------------------------
// 入力解析
// QRスキャン: 数値のみ・最大20桁 → オーダーID
// 手入力: アルファベット1文字＋数字 → 呼出番号からオーダーIDに変換
// -----------------------------------------------
function parseInput(raw, manualMode) {
  var val = raw.trim().toUpperCase();
  if(!manualMode) {
    // A: QRコード形式不正
    if(!QR_RE.test(val)) {
      if(!/^\d+$/.test(val)) return {valid:false, errorType:'A', inputVal:val, reason:'不正なQRコードを読み取りました'};
      return {valid:false, errorType:'A', inputVal:val, reason:'不正なQRコードを読み取りました'};
    }
    var found = orders.find(function(o){ return o.orderId === val; });
    return {valid:true, orderId:val, callNumber: found ? found.callNumber : null};
  } else {
    // B: 手入力形式不正
    if(!CALL_RE.test(val)) return {valid:false, errorType:'B', inputVal:val, reason:'入力値が正しくありません'};
    var found = orders.find(function(o){ return o.callNumber === val; });
    // C: 一覧に存在しない呼出番号
    if(!found) return {valid:false, errorType:'C', inputVal:val, reason:'該当の呼出番号が存在しません'};
    return {valid:true, orderId:found.orderId, callNumber:found.callNumber};
  }
}

// -----------------------------------------------
// タブ切替
// -----------------------------------------------
function switchTab(tab) {
  currentTab = tab;
  ['pending','done','error'].forEach(function(t) {
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
    document.getElementById('content-'+t).classList.toggle('active', t===tab);
  });
  var isPending = tab === 'pending';
  // 更新ボタンは呼出中タブのみ表示
  document.getElementById('refreshBtn').classList.toggle('hidden', !isPending);
  document.getElementById('manualToggleBtn').classList.toggle('hidden', !isPending);
  document.getElementById('cameraBtnHeader').classList.toggle('hidden', !isPending);
  if(!isPending && isCameraOn) stopCamera();
  // 呼出中タブの場合: 手入力モードならscanAreaを表示、カメラモードなら非表示
  if(isPending) {
    if(isManualMode || !isOnline) {
      document.getElementById('scanArea').classList.remove('hidden');
    } else {
      document.getElementById('scanArea').classList.add('hidden');
      if(!isCameraOn) startCamera();
    }
  } else {
    document.getElementById('scanArea').classList.add('hidden');
  }
}

// -----------------------------------------------
// 呼出中レンダリング
// -----------------------------------------------
function renderOrders() {
  var l = document.getElementById('orderList');
  var queuedIds = offlineQueue.map(function(q){ return q.orderId; });
  if(orders.length === 0) {
    l.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">現在呼出中のオーダーはありません。</div>';
    document.getElementById('badge-pending').textContent = 0;
    return;
  }
  l.innerHTML = orders.slice().reverse().map(function(o) {
    var isQueued = queuedIds.indexOf(o.orderId) >= 0;
    return '<div class="order-card'+(isQueued?' queued':'')+'" id="card-'+o.orderId+'">'
      +'<div class="order-id">'+o.callNumber+'</div>'
      +'<div class="order-status'+(isQueued?' queued':'')+'" id="status-'+o.orderId+'">'+(isQueued?'送信待ち':'呼出中')+'</div>'
      +'</div>';
  }).join('');
  document.getElementById('badge-pending').textContent = orders.length;
}

// -----------------------------------------------
// 完了レンダリング
// -----------------------------------------------
function renderDone() {
  var l = document.getElementById('doneList');
  if(doneOrders.length === 0) {
    l.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">完了した注文はありません</div>';
    document.getElementById('badge-done').textContent = 0;
    return;
  }
  l.innerHTML = doneOrders.slice().reverse().map(function(o) {
    return '<div class="order-card done" id="done-card-'+o.orderId+'">'
      +'<div class="order-id done">'+o.callNumber+'</div>'
      +'<div class="order-status" style="background:#EAF3DE;color:#3B6D11;">完了</div>'
      +'<button class="revert-btn" id="revert-btn-'+o.orderId+'" onclick="revertOrder(\''+o.orderId+'\')">戻す</button>'
      +'</div>';
  }).join('');
  document.getElementById('badge-done').textContent = doneOrders.length;
}

function revertOrder(orderId) {
  var card=document.getElementById('done-card-'+orderId), btn=document.getElementById('revert-btn-'+orderId);
  if(!card||!btn) return;
  btn.disabled=true; card.classList.add('reverting');
  mockRevertApiCall(orderId).then(function(rc) {
    if(rc===100) {
      card.classList.add('removing');
      setTimeout(function() {
        var o=doneOrders.find(function(d){return d.orderId===orderId;});
        doneOrders=doneOrders.filter(function(d){return d.orderId!==orderId;});
        if(o) orders.push(o);
        renderDone(); renderOrders();
        showScanToast((o?o.callNumber:orderId)+' を呼出中に戻しました','info');
      }, 300);
    } else { card.classList.remove('reverting'); btn.disabled=false; showScanToast('戻し処理に失敗しました','danger'); }
  }).catch(function(){ card.classList.remove('reverting'); btn.disabled=false; showScanToast('通信エラー','danger'); });
}
function mockRevertApiCall(orderId){ return new Promise(function(res){ setTimeout(function(){ res(Math.random()<0.9?100:900); }, 400); }); }

// -----------------------------------------------
// エラーレンダリング
// -----------------------------------------------
function renderErrors() {
  var count = state.errorItems.length;
  document.getElementById('badge-error').textContent = count;
  document.getElementById('badge-error').className = count>0 ? 'tab-badge has-error' : 'tab-badge';
  document.getElementById('errorActions').style.display = count>0 ? 'block' : 'none';
  var el = document.getElementById('errorList');
  if(state.errorItems.length === 0) { el.innerHTML='<div class="empty-state">エラーはありません</div>'; return; }
  var totalErrors = state.errorItems.length;
  el.innerHTML = state.errorItems.slice().reverse().map(function(e,i) {
    var realIndex = totalErrors - 1 - i;
    var canRetry = RETRYABLE_CODES.indexOf(e.code) >= 0;
    var footer = '<div class="error-card-footer">';
    if(canRetry) footer += '<button class="error-retry" id="retry-btn-'+realIndex+'" onclick="retryError('+realIndex+')">再試行</button>';
    footer += '<button class="error-dismiss" onclick="dismissError('+realIndex+')">消去</button></div>';
    return '<div class="error-card" id="error-card-'+realIndex+'">'
      +'<div class="error-message">'+e.message+'</div>'
      +'<div class="error-id">'+(e.inputVal ? '読取値: '+e.inputVal : (e.callNumber ? e.callNumber+'（ID: '+e.orderId+'）' : 'ID: '+e.orderId))+'</div>'
      +'<div class="error-time">発生時刻: '+e.time+'</div>'
      +footer+'</div>';
  }).join('');
}
function addError(callNumber,code,orderId){
  state.errorItems.push({callNumber:callNumber,code:code,orderId:orderId,message:ERROR_MSGS[code]||'不明なエラー',time:now(),date:todayStr()});
  saveErrorsToStorage();
  renderErrors();
}
// A・B・C用エラー追加（入力値エラー）
function addInputError(errorType, inputVal, reason) {
  if(!errorType || !inputVal) return;
  state.errorItems.push({
    callNumber: null,
    code: 'input_' + errorType,
    orderId: null,
    inputVal: inputVal,
    message: reason,
    time: now(),
    date: todayStr()
  });
  saveErrorsToStorage();
  renderErrors();
}

function dismissError(i){
  state.errorItems.splice(i,1);
  saveErrorsToStorage();
  renderErrors();
}
function clearAllErrors(){
  state.errorItems=[];
  saveErrorsToStorage();
  renderErrors();
}

function retryError(i) {
  var e=state.errorItems[i]; if(!e) return;
  var btn=document.getElementById('retry-btn-'+i); if(btn) btn.disabled=true;
  mockApiCall(e.orderId).then(function(rc) {
    if(rc===100) {
      state.errorItems.splice(i,1);
      var o=orders.find(function(o){return o.orderId===e.orderId;});
      orders=orders.filter(function(o){return o.orderId!==e.orderId;});
      if(o) doneOrders.push(o);
      renderErrors(); renderOrders(); renderDone();
      showScanToast('完了: '+e.callNumber,'success');
    } else {
      state.errorItems[i].code=rc; state.errorItems[i].message=ERROR_MSGS[rc]||'不明なエラー'; state.errorItems[i].time=now();
      renderErrors(); showScanToast(e.callNumber+' の再試行に失敗しました','danger');
    }
  }).catch(function(){ state.errorItems[i].code='network'; state.errorItems[i].message=ERROR_MSGS['network']; state.errorItems[i].time=now(); renderErrors(); showScanToast('通信エラー','danger'); });
}

// -----------------------------------------------
// トースト
// -----------------------------------------------
function showHeaderToast(msg,type){ var t=document.getElementById('headerToast'); t.textContent=msg; t.className='header-toast show '+type; clearTimeout(t._timer); t._timer=setTimeout(function(){t.className='header-toast';},3000); }
function showScanToast(msg,type){ var t=document.getElementById('scanToast'); t.textContent=msg; t.className='scan-toast show '+type; clearTimeout(t._timer); t._timer=setTimeout(function(){t.className='scan-toast';},3000); }

// -----------------------------------------------
// オフライン
// -----------------------------------------------
function updateOfflineBar() {
  var bar=document.getElementById('offlineBar'), text=document.getElementById('offlineBarText'), sub=document.getElementById('offlineBarSub');
  if(!isOnline && offlineQueue.length>0){ text.textContent='オフライン中 — '+offlineQueue.length+'件が送信待ちです'; sub.textContent='ネットワーク復帰後に自動で送信されます'; bar.classList.add('show'); }
  else if(!isOnline){ text.textContent='オフライン中 — スキャンはキューに保存されます'; sub.textContent='ネットワーク復帰後に自動で送信されます'; bar.classList.add('show'); }
  else{ bar.classList.remove('show'); }
}
function showFlushResult(success,failed) {
  var el=document.getElementById('flushResult');
  if(success===0&&failed===0){ el.classList.remove('show'); return; }
  if(failed===0){ el.textContent='オンライン復帰 — '+success+'件の送信が完了しました'; el.className='flush-result show success'; }
  else{ el.textContent='オンライン復帰 — '+success+'件完了 / '+failed+'件はエラーになりました'; el.className='flush-result show partial'; }
  clearTimeout(el._timer); el._timer=setTimeout(function(){el.classList.remove('show');},5000);
}
function updateOnlineStatus() {
  isOnline=navigator.onLine;
  document.getElementById('offlineBadge').classList.toggle('show',!isOnline);
  applyModeUI(); if(isOnline) flushQueue(); updateOfflineBar();
}
function flushQueue() {
  if(!offlineQueue.length) return;
  var total=offlineQueue.length;
  showHeaderToast('オンライン復帰。'+total+'件を送信中...','info');
  var items=offlineQueue.slice(); offlineQueue=[]; updateOfflineBar(); renderOrders();
  var success=0, failed=0, idx=0;
  function next() {
    if(idx>=items.length){ showFlushResult(success,failed); return; }
    var item=items[idx++];
    mockApiCall(item.orderId).then(function(rc){
      if(rc===100){ var o=orders.find(function(o){return o.orderId===item.orderId;}); orders=orders.filter(function(o){return o.orderId!==item.orderId;}); if(o) doneOrders.push(o); success++; renderOrders(); renderDone(); }
      else{ addError(item.callNumber,rc,item.orderId); failed++; }
      setTimeout(next,200);
    }).catch(function(){ addError(item.callNumber,'network',item.orderId); failed++; setTimeout(next,200); });
  }
  next();
}

// -----------------------------------------------
// 手入力モード
// -----------------------------------------------
function toggleManualMode(){
  isManualMode=!isManualMode;
  if(isManualMode && isCameraOn) stopCamera();
  else if(!isManualMode && !isCameraOn) startCamera();
  applyModeUI();
}
function applyModeUI() {
  var scanArea=document.getElementById('scanArea'), input=document.getElementById('scanInput'), btn=document.getElementById('submitBtn'), label=document.getElementById('scanModeLabel'), toggleBtn=document.getElementById('manualToggleBtn');
  var cameraBtn=document.getElementById('cameraBtnHeader');
  var showManual=isManualMode||!isOnline;
  if(showManual){
    // 手入力モード: 入力欄を表示
    scanArea.classList.remove('hidden');
    scanArea.classList.add('manual-mode'); input.classList.add('manual-input'); btn.classList.add('show');
    if(!isOnline){ label.textContent='手入力（オフライン）'; label.className='scan-mode-label show offline'; input.placeholder=PH_OFFLINE; }
    else{ label.textContent='手入力（リーダー・手入力 両対応）'; label.className='scan-mode-label show manual'; input.placeholder=PH_MANUAL; }
    // 手入力ON: アンバー / カメラOFF: 白
    toggleBtn.classList.add('on');
    cameraBtn.textContent='カメラ';
    cameraBtn.classList.remove('on');
  } else {
    // カメラOFF・手入力OFFの場合は入力欄を表示
    if(!isCameraOn) {
      scanArea.classList.remove('hidden');
    } else {
      scanArea.classList.add('hidden');
    }
    scanArea.classList.remove('manual-mode'); input.classList.remove('manual-input'); btn.classList.remove('show');
    label.className='scan-mode-label'; input.placeholder=PH_DEFAULT;
    // 手入力OFF: 白
    toggleBtn.classList.remove('on');
  }
}
function submitManual(){ var v=document.getElementById('scanInput').value.trim(); if(v) onScanComplete(v); }

// -----------------------------------------------
// スキャン処理
// -----------------------------------------------
function isDuplicate(rawId) {
  var n=Date.now();
  if(recentScans[rawId] && n-recentScans[rawId] < DUPLICATE_MS) return true;
  recentScans[rawId]=n; return false;
}
// ===============================
// ⑥ スキャン処理
// ===============================
function canAcceptScan(raw) {
  if (!raw) return false;
  if (processing) return false;
  if (isCameraOn && cameraFreezing) return false;
  if (isDuplicate(raw.trim())) return false;
  return true;
}

function handleScanError(parsed) {
  showScanToast(parsed.reason, 'danger');
  document.getElementById('scanInput').value = '';
  addInputError(parsed.errorType, parsed.inputVal, parsed.reason);

  if (isCameraOn) {
    freezeCamera('error', parsed.reason);
  }
}

function handleValidScan(parsed) {
  processing = true;

  processOrder(parsed.orderId, parsed.callNumber, false)
    .then(function() {
      processing = false;
      document.getElementById('scanInput').value = '';
    });
}

function onScanComplete(raw) {
  if (!canAcceptScan(raw)) return;

  var manualMode = isManualMode || !isOnline;
  var parsed = parseInput(raw, manualMode);

  if (!parsed.valid) {
    handleScanError(parsed);
    return;
  }

  handleValidScan(parsed);
}
// ===============================
// ⑦ 注文処理
// ===============================
function processOrder(orderId, callNumber, fromQueue) {
  var card=document.getElementById('card-'+orderId), statusEl=document.getElementById('status-'+orderId);
  if(card){ card.classList.add('highlight'); if(statusEl){ statusEl.textContent='処理中...'; statusEl.className='order-status processing'; } }
  if(!isOnline) {
    if(!fromQueue) {
      if(!orders.find(function(o){return o.orderId===orderId;})){
        if(card) card.classList.remove('highlight');
        showScanToast('該当のIDが存在しません。\nキューへの登録をスキップしました。','danger');
        return Promise.resolve();
      }
      if(offlineQueue.find(function(q){return q.orderId===orderId;})){
        if(card){ card.classList.remove('highlight'); if(statusEl){ statusEl.textContent='送信待ち'; statusEl.className='order-status queued'; } }
        showScanToast(callNumber+' はすでに送信待ちです。\nネットワーク復帰後に自動送信されます。','warning');
        return Promise.resolve();
      }
      offlineQueue.push({orderId:orderId, callNumber:callNumber});
    }
    updateOfflineBar();
    if(card){ card.classList.remove('highlight'); card.classList.add('queued'); if(statusEl){ statusEl.textContent='送信待ち'; statusEl.className='order-status queued'; } }
    showScanToast(callNumber+' をキューに追加しました。\nネットワーク復帰後に自動送信されます。','warning');
    return Promise.resolve();
  }
  return mockApiCall(orderId).then(function(rc){ handleResult(orderId,callNumber,rc); }).catch(function(){
    if(card){ card.classList.remove('highlight'); if(statusEl){ statusEl.textContent='呼出中'; statusEl.className='order-status'; } }
    addError(callNumber,'network',orderId); showScanToast('通信エラー','danger');
  });
}

function mockApiCall(orderId) {
  return new Promise(function(res){
    setTimeout(function(){
      if(!orders.find(function(o){return o.orderId===orderId;})){ res(300); return; }
      var r=Math.random();
      if(r<0.55) res(100); else if(r<0.65) res(500); else if(r<0.72) res(501); else if(r<0.80) res(300); else if(r<0.90) res(600); else res(900);
    }, 350);
  });
}

function handleResult(orderId, callNumber, rc) {
  var card=document.getElementById('card-'+orderId), statusEl=document.getElementById('status-'+orderId);
  if(rc===100) {
    if(card){ card.classList.add('removing'); setTimeout(function(){ var o=orders.find(function(o){return o.orderId===orderId;}); orders=orders.filter(function(o){return o.orderId!==orderId;}); if(o) doneOrders.push(o); renderOrders(); renderDone(); }, 300); }
    // 同じオーダーIDのエラーカードを自動消去（参照を保ちながら削除）
    var beforeCount = state.errorItems.length;
    for(var ei = state.errorItems.length - 1; ei >= 0; ei--) {
      if(state.errorItems[ei].orderId === orderId) {
        state.errorItems.splice(ei, 1);
      }
    }
    if(state.errorItems.length !== beforeCount){
      saveErrorsToStorage();
      renderErrors();
    }
    showScanToast('完了: '+callNumber,'success');
    if(isCameraOn) freezeCamera('success','完了: '+callNumber);
    // フリーズ中は緑の枠をキープ（clearしない）
  } else {
    if(card){ card.classList.remove('highlight'); if(statusEl){ statusEl.textContent='呼出中'; statusEl.className='order-status'; } }
    addError(callNumber,rc,orderId);
    var msgs={300:'該当のIDが存在しません。',500:'処理済み: '+callNumber,501:'返品済み: '+callNumber,600:'読取エラー',900:'サーバーエラー'};
    var types={300:'warning',500:'warning',501:'warning',600:'danger',900:'danger'};
    var overlayTypes={300:'error',500:'warning',501:'warning',600:'error',900:'error'};
    showScanToast(msgs[rc]||'エラー: '+rc, types[rc]||'danger');
    if(isCameraOn) freezeCamera(overlayTypes[rc]||'error', msgs[rc]||'エラー');
    // フリーズ中は赤の枠を表示
  }
}

// -----------------------------------------------
// 更新
// -----------------------------------------------

// ========================================
// オーダー一覧取得API
// ★ 本番組込時: コメントを外してURLを設定してください
// ========================================
function fetchOrders() {
  // ----------------------------------------
  // 本番用（差し替え箇所）
  // ----------------------------------------
  // return fetch('https://api.xxx.jp/orders')
  //   .then(function(res){ return res.json(); })
  //   .then(function(data){ return data.orders; });
  // ----------------------------------------
  // モック（現在使用中）
  // ----------------------------------------
  return Promise.resolve([
    {orderId:'1',callNumber:'S001'},{orderId:'2',callNumber:'S002'},
    {orderId:'3',callNumber:'M001'},{orderId:'4',callNumber:'M002'},
    {orderId:'5',callNumber:'S003'},{orderId:'6',callNumber:'M003'},
    {orderId:'7',callNumber:'S004'},{orderId:'8',callNumber:'M004'},
    {orderId:'9',callNumber:'S005'},{orderId:'10',callNumber:'M005'},
    {orderId:'11',callNumber:'S006'},{orderId:'12',callNumber:'M006'},
    {orderId:'13',callNumber:'S007'},{orderId:'14',callNumber:'M007'},
    {orderId:'15',callNumber:'S008'},{orderId:'16',callNumber:'M008'},
    {orderId:'17',callNumber:'S009'},{orderId:'18',callNumber:'M009'},
    {orderId:'19',callNumber:'S010'},{orderId:'20',callNumber:'M010'}
  ]);
}

function refreshOrders() {
  fetchOrders().then(function(newOrders) {
    // 呼出中: APIから取得した最新データで更新（参照を保ちながら）
    state.orders.length = 0;
    newOrders.forEach(function(o){ state.orders.push(o); });
    // 完了: リセット
    state.doneOrders.length = 0;
    // オフラインキュー: リセット
    state.offlineQueue.length = 0;
    renderOrders(); renderDone(); updateOfflineBar();
    showHeaderToast('一覧を更新しました','info');
  }).catch(function(){
    showHeaderToast('更新に失敗しました。再試行してください。','info');
  });
}

// -----------------------------------------------
// バーコードリーダー関連コード（コメントアウト中）
// 復帰させる場合はこのブロックのコメントを外してください
// -----------------------------------------------
/*
var SCAN_DELAY = 300;
var scanTimer = null;
document.getElementById('scanInput').addEventListener('keydown', function(e) {
  if(e.key==='Enter'){ e.preventDefault(); if(isManualMode||!isOnline) return; var v=this.value.trim(); if(v) onScanComplete(v); return; }
  if(isManualMode||!isOnline) return;
  clearTimeout(scanTimer);
  scanTimer=setTimeout(function(){ var v=document.getElementById('scanInput').value.trim(); if(v.length>=1) onScanComplete(v); }, SCAN_DELAY);
});
*/

// ===============================
// ③ 初期化
// ===============================
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
// 起動時に当日分のエラーをlocalStorageから読み込む
loadErrorsFromStorage();
updateOnlineStatus();
renderOrders(); renderDone(); renderErrors();
updateDatetime(); setInterval(updateDatetime, 1000);
// WebSocket接続開始（wsEnabled=trueの時のみ接続）
connectWebSocket();
// 起動時にswitchTab経由でボタン状態初期化・カメラ起動
switchTab('pending');
</script>