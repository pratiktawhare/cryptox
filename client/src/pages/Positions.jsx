/**
 * Positions.jsx - Professional trading positions with real-time mark price,
 * SL/TP modify, partial close, liquidation bar, and margin ratio.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useTradingMode } from "../context/TradingModeContext";
import TradeConfirmDialog from "../components/trading/TradeConfirmDialog";
import NotificationBell from "../components/common/NotificationBell";
import MobileBottomNav from "../components/layout/MobileBottomNav";

const SOCKET_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : (typeof window !== "undefined"
    ? window.location.protocol + "//" + window.location.hostname + ":3001"
    : "http://localhost:3001");

function fmt(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtP(n) {
  if (!n && n !== 0) return "-";
  const abs = Math.abs(n);
  const dec = abs >= 10000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return (n < 0 ? "-" : "") + "$" + fmt(abs, dec);
}
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return new Date(date).toLocaleDateString();
}
function pnlColor(n) {
  if (!n && n !== 0) return "text-crypto-muted";
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-crypto-muted";
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- Wallet Banner ---

function WalletBanner({ wallet, isPaper }) {
  if (!wallet) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        {["Total Equity", "Available", "Used Margin", "uPnL"].map((label) => (
          <div key={label} className="bg-crypto-card border border-crypto-border rounded-2xl p-3 md:p-4 animate-pulse">
            <div className="text-[10px] text-crypto-muted uppercase tracking-wider mb-2">{label}</div>
            <div className="h-5 md:h-6 w-20 md:w-24 bg-crypto-border rounded" />
          </div>
        ))}
      </div>
    );
  }
  const totalPnl = wallet.unrealisedPnl ?? 0;
  const marginRatio = wallet.used && wallet.equity ? (wallet.used / wallet.equity) * 100 : 0;
  const stats = [
    { label: "Total Equity", value: "$" + fmt(wallet.equity), color: "text-crypto-heading" },
    { label: "Available", value: "$" + fmt(wallet.available), color: "text-emerald-400" },
    { label: "Used Margin", value: "$" + fmt(wallet.used), color: marginRatio > 70 ? "text-red-400" : "text-crypto-primary", mr: marginRatio },
    { label: "Unrealised PnL", value: (totalPnl >= 0 ? "+" : "") + "$" + fmt(totalPnl), color: pnlColor(totalPnl) },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
      {stats.map(({ label, value, color, mr }) => (
        <div key={label} className="bg-crypto-card border border-crypto-border rounded-2xl p-3 md:p-4">
          <div className="text-[10px] text-crypto-muted uppercase tracking-wider mb-1 flex items-center justify-between">
            {label}
            {isPaper && label === "Total Equity" && (
              <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1 rounded">PAPER</span>
            )}
          </div>
          <div className={"text-lg md:text-xl font-bold tabular-nums " + color}>{value}</div>
          {mr > 0 && (
            <div className="mt-2">
              <div className="h-1 bg-crypto-border rounded-full overflow-hidden">
                <div
                  className={"h-1 rounded-full transition-all " + (mr > 70 ? "bg-red-400" : mr > 40 ? "bg-yellow-400" : "bg-crypto-primary")}
                  style={{ width: clamp(mr, 0, 100) + "%" }}
                />
              </div>
              <div className="text-[9px] text-crypto-muted mt-0.5">{fmt(mr, 1)}% of equity</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Modify SL/TP Dialog ---

function ModifyDialog({ pos, onClose, onSave, markPrice }) {
  const [sl, setSl] = useState(pos.stopLoss != null ? String(pos.stopLoss) : "");
  const [tp, setTp] = useState(pos.takeProfit != null ? String(pos.takeProfit) : "");
  const [saving, setSaving] = useState(false);
  const isLong = pos.side === "buy";

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(pos, {
        stopLoss: sl === "" ? null : parseFloat(sl),
        takeProfit: tp === "" ? null : parseFloat(tp),
      });
      onClose();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || e.message);
    } finally { setSaving(false); }
  };

  const slPct = sl && markPrice ? (Math.abs(markPrice - parseFloat(sl)) / markPrice * 100).toFixed(2) : null;
  const tpPct = tp && markPrice ? (Math.abs(markPrice - parseFloat(tp)) / markPrice * 100).toFixed(2) : null;
  const slWarn = sl && markPrice && ((isLong && parseFloat(sl) >= markPrice) || (!isLong && parseFloat(sl) <= markPrice));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-crypto-card border border-crypto-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-crypto-heading">Modify Order</h2>
            <p className="text-xs text-crypto-muted mt-0.5">{pos.symbol.replace("USD", "/USD")} · {isLong ? "Long" : "Short"} · {pos.leverage}×</p>
          </div>
          <button onClick={onClose} className="text-crypto-muted hover:text-crypto-heading cursor-pointer p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {markPrice && (
          <div className="bg-crypto-bg-subtle rounded-xl p-3 mb-4 flex items-center justify-between">
            <span className="text-xs text-crypto-muted">Mark Price</span>
            <span className="text-sm font-bold text-crypto-heading tabular-nums">{fmtP(markPrice)}</span>
          </div>
        )}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-red-400 mb-1.5">
            Stop Loss {slPct && <span className="text-crypto-muted font-normal">({slPct}% away)</span>}
          </label>
          <div className="relative">
            <input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)}
              placeholder={isLong ? "Below entry price" : "Above entry price"}
              className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading placeholder-crypto-muted focus:outline-none focus:border-red-400/60 transition-colors" />
            {sl && <button onClick={() => setSl("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-crypto-muted hover:text-crypto-heading cursor-pointer text-xs">✕</button>}
          </div>
          {slWarn && <p className="text-[10px] text-red-400 mt-1">⚠ SL would trigger immediately at current price</p>}
          {sl && markPrice && !slWarn && <p className="text-[10px] text-crypto-muted mt-1">Distance: {fmtP(Math.abs(markPrice - parseFloat(sl)))}</p>}
        </div>
        <div className="mb-6">
          <label className="block text-xs font-semibold text-emerald-400 mb-1.5">
            Take Profit {tpPct && <span className="text-crypto-muted font-normal">({tpPct}% away)</span>}
          </label>
          <div className="relative">
            <input type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)}
              placeholder={isLong ? "Above entry price" : "Below entry price"}
              className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading placeholder-crypto-muted focus:outline-none focus:border-emerald-400/60 transition-colors" />
            {tp && <button onClick={() => setTp("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-crypto-muted hover:text-crypto-heading cursor-pointer text-xs">✕</button>}
          </div>
          {tp && markPrice && <p className="text-[10px] text-crypto-muted mt-1">Distance: {fmtP(Math.abs(markPrice - parseFloat(tp)))}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-crypto-border text-sm text-crypto-muted hover:text-crypto-heading cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-crypto-primary text-white text-sm font-bold hover:bg-crypto-primary/90 cursor-pointer disabled:opacity-50">{saving ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// --- Partial Close Dialog ---

function PartialCloseDialog({ pos, onClose, onPartialClose, markPrice }) {
  const [size, setSize] = useState(Math.max(1, Math.floor(pos.size / 2)));
  const [selectedPercent, setSelectedPercent] = useState(50);
  const [saving, setSaving] = useState(false);
  const isLong = pos.side === "buy";
  const priceDiff = markPrice ? (isLong ? markPrice - pos.entryPrice : pos.entryPrice - markPrice) : 0;
  const estimatedPnl = priceDiff * size;
  const pct = pos.size > 0 ? Math.round((size / pos.size) * 100) : 0;
  const presets = [25, 50, 75, 100].map((p) => Math.max(1, Math.round((pos.size * p) / 100)));

  const handleClose = async () => {
    setSaving(true);
    try { await onPartialClose(pos, size); onClose(); }
    catch (e) { alert((e.response && e.response.data && e.response.data.error) || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-crypto-card border border-crypto-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-crypto-heading">Close Position</h2>
            <p className="text-xs text-crypto-muted mt-0.5">{pos.symbol.replace("USD", "/USD")} · Total: {pos.size} contracts</p>
          </div>
          <button onClick={onClose} className="text-crypto-muted hover:text-crypto-heading cursor-pointer p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {markPrice && (
          <div className="bg-crypto-bg-subtle rounded-xl p-3 mb-4 flex items-center justify-between">
            <span className="text-xs text-crypto-muted">Close at Market</span>
            <span className="text-sm font-bold text-crypto-heading tabular-nums">{fmtP(markPrice)}</span>
          </div>
        )}
        <div className="mb-4">
          <label className="text-xs text-crypto-muted mb-2 block">Close Size ({pct}% of position)</label>
          <div className="flex gap-2 mb-3">
            {[25, 50, 75, 100].map((p, i) => (
              <button key={p} onClick={() => { setSize(presets[i]); setSelectedPercent(p); }}
                className={"flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer " + (selectedPercent === p ? "bg-crypto-primary text-white" : "bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading border border-crypto-border")}>
                {p}%
              </button>
            ))}
          </div>
          <input type="number" min="1" max={pos.size} value={size}
            onChange={(e) => {
              const val = Math.max(1, Math.min(pos.size, parseInt(e.target.value) || 1));
              setSize(val);
              setSelectedPercent(null);
            }}
            className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-crypto-primary/60" />
          <p className="text-[10px] text-crypto-muted mt-1">Remaining: {pos.size - size} contracts</p>
        </div>
        {markPrice && (
          <div className={"rounded-xl p-3 mb-5 flex items-center justify-between " + (estimatedPnl >= 0 ? "bg-emerald-400/5 border border-emerald-400/20" : "bg-red-400/5 border border-red-400/20")}>
            <span className="text-xs text-crypto-muted">Estimated PnL</span>
            <span className={"text-sm font-bold tabular-nums " + pnlColor(estimatedPnl)}>{estimatedPnl >= 0 ? "+" : ""}{fmtP(estimatedPnl)}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-crypto-border text-sm text-crypto-muted hover:text-crypto-heading cursor-pointer">Cancel</button>
          <button onClick={handleClose} disabled={saving}
            className={"flex-1 py-2.5 rounded-xl text-white text-sm font-bold cursor-pointer disabled:opacity-50 " + (size >= pos.size ? "bg-red-500 hover:bg-red-600" : "bg-crypto-primary hover:bg-crypto-primary/90")}>
            {saving ? "Closing…" : size >= pos.size ? "Close All" : "Close " + size}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Add-to-Position Dialog ---

function AddToPositionDialog({ pos, onClose, onAdd, markPrice }) {
  const [addSize, setAddSize] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isLong = pos.side === "buy";
  const currentPrice = markPrice || pos.markPrice || pos.entryPrice;

  // Preview: weighted avg entry
  const newAvgEntry = addSize > 0
    ? (pos.entryPrice * pos.size + currentPrice * addSize) / (pos.size + addSize)
    : pos.entryPrice;
  const newMargin = (currentPrice * addSize) / pos.leverage;

  const handleAdd = async () => {
    if (addSize < 1) { setError("Size must be at least 1"); return; }
    setSaving(true);
    setError("");
    try {
      await onAdd(pos._id, addSize);
      onClose();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || e.message);
    } finally { setSaving(false); }
  };

  const accentCls = isLong ? "text-emerald-400" : "text-red-400";
  const accentBg  = isLong ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-crypto-card border border-crypto-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-crypto-heading">Add to Position</h2>
            <p className="text-xs text-crypto-muted mt-0.5">
              {pos.symbol.replace("USD", "/USD")} · <span className={accentCls}>{isLong ? "Long" : "Short"}</span> · {pos.leverage}×
            </p>
          </div>
          <button onClick={onClose} className="text-crypto-muted hover:text-crypto-heading cursor-pointer p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Current position summary */}
        <div className="bg-crypto-bg-subtle rounded-xl p-3 mb-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Cur. Entry</div>
            <div className="text-xs font-bold text-crypto-heading tabular-nums">${Number(pos.entryPrice).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})}</div>
          </div>
          <div>
            <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Cur. Size</div>
            <div className="text-xs font-bold text-crypto-heading">{pos.size} cts</div>
          </div>
          <div>
            <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Mark Price</div>
            <div className="text-xs font-bold text-crypto-heading tabular-nums">${Number(currentPrice).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})}</div>
          </div>
        </div>

        {/* Size input */}
        <div className="mb-4">
          <label className="text-xs text-crypto-muted mb-2 block">Contracts to Add</label>
          <div className="flex gap-2 mb-3">
            {[1,2,5,10].map((p) => (
              <button key={p} onClick={() => setAddSize(p)}
                className={"flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer " + (addSize === p ? "bg-crypto-primary text-white" : "bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading border border-crypto-border")}>
                +{p}
              </button>
            ))}
          </div>
          <input type="number" min="1" value={addSize}
            onChange={(e) => setAddSize(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-crypto-primary/60" />
        </div>

        {/* Preview */}
        <div className="bg-crypto-bg-subtle rounded-xl p-3 mb-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[9px] text-emerald-400/80 uppercase mb-0.5">New Avg Entry</div>
            <div className="text-xs font-bold text-crypto-heading tabular-nums">${newAvgEntry.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})}</div>
          </div>
          <div>
            <div className="text-[9px] text-emerald-400/80 uppercase mb-0.5">New Size</div>
            <div className="text-xs font-bold text-crypto-heading">{pos.size + addSize} cts</div>
          </div>
          <div>
            <div className="text-[9px] text-red-400/80 uppercase mb-0.5">Extra Margin</div>
            <div className="text-xs font-bold text-red-400 tabular-nums">-${newMargin.toFixed(2)}</div>
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl p-3 mb-4">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-crypto-border text-sm text-crypto-muted hover:text-crypto-heading cursor-pointer">Cancel</button>
          <button onClick={handleAdd} disabled={saving}
            className={"flex-1 py-2.5 rounded-xl text-white text-sm font-bold cursor-pointer disabled:opacity-50 transition-colors " + accentBg}>
            {saving ? "Adding…" : `Add ${addSize} Contract${addSize > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Reset Balance Dialog ---

function ResetBalanceDialog({ onClose, onReset }) {
  const [balance, setBalance] = useState("10000");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async () => {
    const val = parseFloat(balance);
    if (isNaN(val) || val < 100 || val > 1000000) {
      setError("Please enter an amount between $100 and $1,000,000");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onReset(val);
      onClose();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || e.message);
    } finally {
      setSaving(false);
    }
  };

  const presets = [1000, 10000, 50000, 100000];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-crypto-card border border-crypto-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-crypto-heading">Reset Paper Balance</h2>
            <p className="text-xs text-crypto-muted mt-0.5">This will close all open paper positions.</p>
          </div>
          <button onClick={onClose} className="text-crypto-muted hover:text-crypto-heading cursor-pointer p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl p-3 mb-4">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="text-xs text-crypto-muted mb-2 block">Select starting balance</label>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {presets.map((p) => (
              <button key={p} onClick={() => setBalance(String(p))}
                className={"py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer " + (parseFloat(balance) === p ? "bg-crypto-primary text-white" : "bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading border border-crypto-border")}>
                ${p.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-crypto-muted text-sm">$</span>
            <input type="number" min="100" max="1000000" value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-full bg-crypto-bg border border-crypto-border rounded-xl pl-7 pr-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-crypto-primary/60" />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-crypto-border text-sm text-crypto-muted hover:text-crypto-heading cursor-pointer">Cancel</button>
          <button onClick={handleReset} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold cursor-pointer disabled:opacity-50 transition-colors">
            {saving ? "Resetting…" : "Reset Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Position Card ---

function PositionCard({ pos, livePrices, onClose, onModify, onPartialClose, onAdd, isPaper }) {
  const navigate = useNavigate();
  const [showModify, setShowModify] = useState(false);
  const [showPartial, setShowPartial] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isLong = pos.side === "buy";
  const markPrice = livePrices[pos.symbol] != null ? livePrices[pos.symbol] : pos.markPrice != null ? pos.markPrice : pos.entryPrice;
  const entry = pos.entryPrice;
  const size = pos.size;
  const leverage = pos.leverage;

  const priceDiff = isLong ? markPrice - entry : entry - markPrice;
  const unrealisedPnl = pos.unrealisedPnl != null ? pos.unrealisedPnl : priceDiff * size;
  const margin = pos.marginUsed || pos.margin || (entry * size) / leverage;
  const roe = margin > 0 ? (unrealisedPnl / margin) * 100 : 0;
  const entryPct = entry > 0 ? ((markPrice - entry) / entry) * 100 * (isLong ? 1 : -1) : 0;
  const liqPrice = pos.liquidationPrice != null ? pos.liquidationPrice : (isLong ? entry * (1 - 0.9 / leverage) : entry * (1 + 0.9 / leverage));
  const distToSl = pos.stopLoss ? Math.abs(markPrice - pos.stopLoss) : null;
  const distToTp = pos.takeProfit ? Math.abs(markPrice - pos.takeProfit) : null;
  const liqDist = Math.abs(entry - liqPrice);
  const currDist = Math.abs(markPrice - liqPrice);
  const liqPct = liqDist > 0 ? clamp(100 - (currDist / liqDist) * 100, 0, 100) : 0;
  const borderColor = unrealisedPnl > 0 ? "border-emerald-500/20" : unrealisedPnl < 0 ? "border-red-500/20" : "border-crypto-border";

  return (
    <>
      <div className={"bg-crypto-card border " + borderColor + " rounded-2xl transition-all duration-200"}>
        <div className="p-3 md:p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3 md:mb-4">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className={"w-8 h-8 md:w-10 md:h-10 rounded-xl flex items-center justify-center text-base md:text-xl font-black flex-shrink-0 " + (isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                {isLong ? "↑" : "↓"}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span 
                    onClick={() => navigate(`/?coin=${pos.symbol}`)}
                    className="text-sm font-bold text-crypto-heading hover:text-crypto-primary cursor-pointer transition-colors duration-150 flex items-center gap-1 group/sym hover:underline decoration-crypto-primary/40 underline-offset-4"
                    title={`View ${pos.symbol.replace("USD", "/USD")} Chart`}
                  >
                    {pos.symbol.replace("USD", "/USD")}
                    <svg className="w-3.5 h-3.5 text-crypto-muted group-hover/sym:text-crypto-primary transition-colors duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                    </svg>
                  </span>
                  <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded-md " + (isLong ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                    {isLong ? "LONG" : "SHORT"}
                  </span>
                  <span className="text-[10px] text-crypto-muted bg-crypto-bg-subtle px-1.5 py-0.5 rounded-md">{leverage}×</span>
                  {isPaper && <span className="text-[9px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-md border border-yellow-400/20">PAPER</span>}
                </div>
                <div className="text-[10px] text-crypto-muted mt-0.5">{size} contracts · {timeAgo(pos.createdAt)}</div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className={"text-base md:text-lg font-black tabular-nums leading-tight " + pnlColor(unrealisedPnl)}>
                {unrealisedPnl >= 0 ? "+" : ""}{fmtP(unrealisedPnl)}
              </div>
              <div className={"text-[10px] md:text-xs font-semibold tabular-nums " + pnlColor(roe)}>ROE {roe >= 0 ? "+" : ""}{fmt(roe, 2)}%</div>
            </div>
          </div>

          {/* Price grid */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-crypto-bg-subtle rounded-xl p-2.5">
              <div className="text-[9px] text-crypto-muted uppercase tracking-wider mb-0.5">Entry</div>
              <div className="text-xs font-bold text-crypto-heading tabular-nums">{fmtP(entry)}</div>
            </div>
            <div className="bg-crypto-bg-subtle rounded-xl p-2.5">
              <div className="text-[9px] text-crypto-muted uppercase tracking-wider mb-0.5">Mark ⚡</div>
              <div className="text-xs font-bold text-crypto-heading tabular-nums">{fmtP(markPrice)}</div>
              <div className={"text-[9px] font-semibold tabular-nums " + (entryPct >= 0 ? "text-emerald-400" : "text-red-400")}>
                {entryPct >= 0 ? "+" : ""}{fmt(Math.abs(entryPct), 3)}%
              </div>
            </div>
            <div className="bg-crypto-bg-subtle rounded-xl p-2.5">
              <div className="text-[9px] text-orange-400/80 uppercase tracking-wider mb-0.5">Liq. Price</div>
              <div className="text-xs font-bold text-orange-400 tabular-nums">{fmtP(liqPrice)}</div>
            </div>
          </div>

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className={"rounded-xl p-2.5 " + (pos.stopLoss ? "bg-red-500/5 border border-red-500/15" : "bg-crypto-bg-subtle")}>
              <div className="text-[9px] text-red-400/80 uppercase tracking-wider mb-0.5">Stop Loss</div>
              <div className={"text-xs font-bold tabular-nums " + (pos.stopLoss ? "text-red-400" : "text-crypto-muted")}>
                {pos.stopLoss ? fmtP(pos.stopLoss) : "Not set"}
              </div>
              {distToSl != null && <div className="text-[9px] text-crypto-muted mt-0.5">{fmtP(distToSl)} away</div>}
            </div>
            <div className={"rounded-xl p-2.5 " + (pos.takeProfit ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-crypto-bg-subtle")}>
              <div className="text-[9px] text-emerald-400/80 uppercase tracking-wider mb-0.5">Take Profit</div>
              <div className={"text-xs font-bold tabular-nums " + (pos.takeProfit ? "text-emerald-400" : "text-crypto-muted")}>
                {pos.takeProfit ? fmtP(pos.takeProfit) : "Not set"}
              </div>
              {distToTp != null && <div className="text-[9px] text-crypto-muted mt-0.5">{fmtP(distToTp)} away</div>}
            </div>
          </div>

          {/* Liquidation risk bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-crypto-muted">Liquidation Risk</span>
              <span className={"text-[9px] font-semibold " + (liqPct > 70 ? "text-red-400" : liqPct > 40 ? "text-yellow-400" : "text-emerald-400")}>{fmt(liqPct, 0)}%</span>
            </div>
            <div className="h-1.5 bg-crypto-border rounded-full overflow-hidden">
              <div
                className={"h-1.5 rounded-full transition-all duration-500 " + (liqPct > 70 ? "bg-red-400" : liqPct > 40 ? "bg-yellow-400" : "bg-emerald-400")}
                style={{ width: liqPct + "%" }}
              />
            </div>
          </div>

          {/* Expanded */}
          {expanded && (
            <div className="mb-4 pt-3 border-t border-crypto-border/40 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <div>
                <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Position Value</div>
                <div className="text-xs text-crypto-heading tabular-nums">{fmtP(markPrice * size)}</div>
              </div>
              <div>
                <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Margin Used</div>
                <div className="text-xs text-crypto-heading tabular-nums">{fmtP(margin)}</div>
              </div>
              <div>
                <div className="text-[9px] text-crypto-muted uppercase mb-0.5">PnL per Contract</div>
                <div className={"text-xs font-semibold tabular-nums " + pnlColor(priceDiff)}>{priceDiff >= 0 ? "+" : ""}{fmtP(priceDiff)}</div>
              </div>
              <div>
                <div className="text-[9px] text-crypto-muted uppercase mb-0.5">Opened</div>
                <div className="text-xs text-crypto-heading">{new Date(pos.createdAt).toLocaleString()}</div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => navigate(`/?coin=${pos.symbol}`)}
              className="px-2.5 py-2 rounded-xl bg-crypto-bg-subtle border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-primary hover:border-crypto-primary/30 transition-all cursor-pointer flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
              Chart
            </button>
            <button onClick={() => setShowModify(true)}
              className="flex-1 py-2 rounded-xl bg-crypto-bg-subtle border border-crypto-border text-xs font-semibold text-crypto-muted hover:text-crypto-primary hover:border-crypto-primary/30 transition-all cursor-pointer flex items-center justify-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              SL/TP
            </button>
            {isPaper && (
              <button onClick={() => setShowAdd(true)}
                className={"flex-1 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 " + (isLong ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20" : "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20")}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add
              </button>
            )}
            <button onClick={() => setShowPartial(true)}
              className="flex-1 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </button>
            <button onClick={() => setExpanded((v) => !v)}
              className="py-2 px-3 rounded-xl bg-crypto-bg-subtle border border-crypto-border text-xs text-crypto-muted hover:text-crypto-heading transition-all cursor-pointer">
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>
      </div>

      {showModify && <ModifyDialog pos={pos} markPrice={markPrice} onClose={() => setShowModify(false)} onSave={onModify} />}
      {showPartial && <PartialCloseDialog pos={pos} markPrice={markPrice} onClose={() => setShowPartial(false)} onPartialClose={onPartialClose} />}
      {showAdd && <AddToPositionDialog pos={pos} markPrice={markPrice} onClose={() => setShowAdd(false)} onAdd={onAdd} />}
    </>
  );
}

// --- History Row ---

function HistoryRow({ trade }) {
  const navigate = useNavigate();
  const isBuy = trade.side === "buy";
  const statusMap = { closed_tp: "TP Hit", closed_sl: "SL Hit", closed_manual: "Manual", filled: "Filled", cancelled: "Cancelled", failed: "Failed" };
  const statusText = statusMap[trade.status] || trade.status;
  const sc = {
    "TP Hit": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    "SL Hit": "text-red-400 bg-red-400/10 border-red-400/20",
    "Manual": "text-blue-400 bg-blue-400/10 border-blue-400/20",
    "Filled": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    "Cancelled": "text-crypto-muted bg-crypto-bg-subtle border-crypto-border",
    "Failed": "text-red-400 bg-red-400/10 border-red-400/20",
  };
  const statusColor = sc[statusText] || "text-crypto-muted bg-crypto-bg-subtle border-crypto-border";
  const pnl = trade.realisedPnl != null ? trade.realisedPnl : trade.pnl;
  return (
    <tr className="border-b border-crypto-border/40 hover:bg-crypto-bg-subtle/50 transition-colors">
      <td className="px-4 py-3 whitespace-nowrap">
        <div className={"text-xs font-bold " + (isBuy ? "text-emerald-400" : "text-red-400")}>{isBuy ? "LONG" : "SHORT"}</div>
        <div className="text-[10px] text-crypto-muted mt-0.5">{timeAgo(trade.closedAt || trade.createdAt)}</div>
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-crypto-heading">
        <span
          onClick={() => navigate(`/?coin=${trade.symbol}`)}
          className="hover:text-crypto-primary cursor-pointer transition-colors duration-150 inline-flex items-center gap-1 group/sym hover:underline decoration-crypto-primary/40 underline-offset-4"
          title={`View ${(trade.symbol || "").replace("USD", "/USD")} Chart`}
        >
          {(trade.symbol || "").replace("USD", "/USD")}
          <svg className="w-3 h-3 text-crypto-muted group-hover/sym:text-crypto-primary transition-colors duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
          </svg>
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-crypto-heading tabular-nums">{trade.size}</td>
      <td className="px-4 py-3 text-sm text-crypto-heading tabular-nums">{fmtP(trade.filledPrice || trade.price || trade.entryPrice) || "Market"}</td>
      <td className="px-4 py-3 text-xs text-crypto-muted">{trade.leverage}×</td>
      <td className="px-4 py-3"><span className={"text-[10px] font-semibold px-2 py-0.5 rounded-full border " + statusColor}>{statusText}</span></td>
      <td className="px-4 py-3">{pnl != null ? <span className={"text-sm font-bold tabular-nums " + pnlColor(pnl)}>{pnl >= 0 ? "+" : ""}{fmtP(pnl)}</span> : <span className="text-xs text-crypto-muted">—</span>}</td>
      <td className="px-4 py-3 text-xs text-crypto-muted max-w-xs truncate">{trade.closePrice ? "Closed @ " + fmtP(trade.closePrice) : (trade.errorMessage || trade.source || "—")}</td>
    </tr>
  );
}

// --- Edit Order Dialog ---
function EditOrderDialog({ order, onClose, onSave }) {
  const [size, setSize] = React.useState(String(order.size));
  const [price, setPrice] = React.useState(String(order.stopPrice || order.limitPrice || ""));
  const [sl, setSl] = React.useState(order.bracketStopLossPrice != null ? String(order.bracketStopLossPrice) : "");
  const [tp, setTp] = React.useState(order.bracketTakeProfitPrice != null ? String(order.bracketTakeProfitPrice) : "");
  const [saving, setSaving] = React.useState(false);

  const isStop = order.stopPrice !== null;
  const isParent = !order.stopOrderType;
  const priceLabel = isStop ? "Trigger Price" : "Limit Price";

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        id: order.id,
        symbol: order.symbol,
        size: parseInt(size),
      };
      if (isStop) {
        data.stopPrice = parseFloat(price);
      } else {
        data.limitPrice = parseFloat(price);
      }
      if (isParent) {
        data.bracketStopLossPrice = sl === "" ? null : parseFloat(sl);
        data.bracketTakeProfitPrice = tp === "" ? null : parseFloat(tp);
      }
      await onSave(data);
      onClose();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-crypto-card border border-crypto-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-crypto-heading">Edit Open Order</h2>
            <p className="text-xs text-crypto-muted mt-0.5">{order.symbol.replace("USD", "/USD")} · {order.side.toUpperCase()}</p>
          </div>
          <button onClick={onClose} className="text-crypto-muted hover:text-crypto-heading cursor-pointer p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-crypto-muted mb-1.5">Contracts (Size)</label>
          <input type="number" min="1" value={size} onChange={(e) => setSize(e.target.value)}
            className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-crypto-primary/60 transition-colors" />
        </div>
        {(order.stopPrice !== null || order.limitPrice !== null) && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-crypto-muted mb-1.5">{priceLabel}</label>
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-crypto-primary/60 transition-colors" />
          </div>
        )}
        {isParent && (
          <>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-red-400 mb-1.5">Bracket Stop Loss</label>
              <input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)}
                placeholder="Not set"
                className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-red-400/60 transition-colors" />
            </div>
            <div className="mb-6">
              <label className="block text-xs font-semibold text-emerald-400 mb-1.5">Bracket Take Profit</label>
              <input type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)}
                placeholder="Not set"
                className="w-full bg-crypto-bg border border-crypto-border rounded-xl px-3 py-2.5 text-sm text-crypto-heading focus:outline-none focus:border-emerald-400/60 transition-colors" />
            </div>
          </>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-crypto-border text-sm text-crypto-muted hover:text-crypto-heading cursor-pointer">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-crypto-primary text-white text-sm font-bold hover:bg-crypto-primary/90 cursor-pointer disabled:opacity-50">{saving ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---

const Positions = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPaper } = useTradingMode();

  const [positions, setPositions] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [history, setHistory] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [editingOrder, setEditingOrder] = useState(null);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("positions");
  const [livePrices, setLivePrices] = useState({});
  const [tradeOpen, setTradeOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Track the current isPaper value to ignore stale asynchronous requests
  const isPaperRef = useRef(isPaper);
  useEffect(() => {
    isPaperRef.current = isPaper;
    setLoading(true); // show loading spinner immediately on mode switch
  }, [isPaper]);

  const load = useCallback(async () => {
    const activeIsPaper = isPaper;
    try {
      if (activeIsPaper) {
        const [posRes, walletRes, ordersRes] = await Promise.allSettled([
          api.get("/paper/positions"),
          api.get("/paper/wallet"),
          api.get("/paper/open-orders"),
        ]);
        // If mode changed since we fired this request, discard the response
        if (activeIsPaper !== isPaperRef.current) return;

        if (posRes.status === "fulfilled") {
          setPositions((posRes.value.data.positions || []).map((p) => ({
            ...p,
            markPrice: p.markPrice || p.entryPrice,
            unrealisedPnl: p.unrealisedPnl || 0,
          })));
        }
        if (walletRes.status === "fulfilled") {
          const w = walletRes.value.data.wallet;
          if (w) setWallet({ equity: w.equity != null ? w.equity : w.balance, available: w.available != null ? w.available : w.balance, used: w.used != null ? w.used : 0, unrealisedPnl: w.unrealisedPnl != null ? w.unrealisedPnl : 0 });
        }
        if (ordersRes.status === "fulfilled") {
          setOpenOrders(ordersRes.value.data.openOrders || []);
        }
      } else {
        const [posRes, walletRes, ordersRes] = await Promise.allSettled([
          api.get("/trading/positions"),
          api.get("/trading/wallet"),
          api.get("/trading/open-orders")
        ]);
        // If mode changed since we fired this request, discard the response
        if (activeIsPaper !== isPaperRef.current) return;

        if (posRes.status === "fulfilled") setPositions(posRes.value.data.positions || []);
        if (walletRes.status === "fulfilled") setWallet(walletRes.value.data.wallet);
        if (ordersRes.status === "fulfilled") setOpenOrders(ordersRes.value.data.openOrders || []);
      }
    } catch (_) {}
    finally {
      if (activeIsPaper === isPaperRef.current) {
        setLoading(false);
      }
    }
  }, [isPaper]);

  const loadHistory = useCallback(async (page = 1) => {
    const activeIsPaper = isPaper;
    try {
      const res = await api.get(activeIsPaper ? "/paper/history?page=" + page + "&limit=30" : "/trading/history?page=" + page + "&limit=30");
      // If mode changed since we fired this request, discard the response
      if (activeIsPaper !== isPaperRef.current) return;

      const trades = res.data.history || res.data.trades || [];
      setHistory(trades);
      setHistTotal(res.data.count != null ? res.data.count : res.data.total != null ? res.data.total : trades.length);
      setHistPage(page);
    } catch (_) {}
  }, [isPaper]);

  useEffect(() => {
    load();
    loadHistory(1);

    const interval = setInterval(() => {
      load();
    }, 6000);

    return () => clearInterval(interval);
  }, [load, loadHistory]);

  useEffect(() => {
    load();
  }, [tab, load]);

  useEffect(() => {
    const seed = {};
    positions.forEach((p) => { if (p.markPrice) seed[p.symbol] = p.markPrice; });
    setLivePrices((prev) => ({ ...seed, ...prev }));
  }, [positions]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { withCredentials: true });
    socket.on("connect", () => { if (user && (user._id || user.id)) socket.emit("join_user_room", user._id || user.id); });

    // Listen to live WebSocket prices
    socket.on("ticker", ({ symbol, price }) => {
      setLivePrices((prev) => ({ ...prev, [symbol]: price }));
    });

    // Listen to paper trading engine real-time ticks (updates ROE and markPrice every 5s)
    socket.on("paper_pnl_update", ({ positionId, symbol, markPrice, unrealisedPnl, roe }) => {
      if (isPaperRef.current) {
        setPositions((prev) => prev.map((p) => p._id === positionId ? { ...p, markPrice, unrealisedPnl, roe } : p));
      }
      setLivePrices((prev) => ({ ...prev, [symbol]: markPrice }));
    });

    socket.on("paper_position_updated", (updated) => {
      if (isPaperRef.current) {
        setPositions((prev) => prev.map((p) => p._id === updated._id ? { ...p, ...updated } : p));
      }
      if (updated.markPrice) setLivePrices((prev) => ({ ...prev, [updated.symbol]: updated.markPrice }));
    });

    socket.on("paper_position_closed", () => {
      if (isPaperRef.current) {
        load();
        loadHistory(1);
      }
    });

    // Live trading updates
    socket.on("positions_update", ({ positions: p }) => {
      if (!isPaperRef.current) {
        setPositions(p || []);
      }
    });
    socket.on("wallet_update", ({ wallet: w }) => {
      if (!isPaperRef.current) {
        setWallet(w);
      }
    });

    // Order placement triggers refresh
    socket.on("order_placed", () => {
      if (!isPaperRef.current) {
        load();
        loadHistory(1);
      }
    });
    socket.on("paper_order_placed", () => {
      if (isPaperRef.current) {
        load();
        loadHistory(1);
      }
    });

    return () => socket.disconnect();
  }, [user, load, loadHistory]);

  const handleClosePosition = useCallback(async (pos) => {
    if (isPaper) await api.post("/paper/close/" + pos._id);
    else await api.post("/trading/close", { symbol: pos.symbol, size: Math.abs(pos.size), side: pos.side });
    load();
  }, [isPaper, load]);

  const handleModify = useCallback(async (pos, data) => {
    if (isPaper) {
      await api.patch("/paper/position/" + pos._id, data);
    } else {
      await api.patch("/trading/position/" + pos.symbol, data);
    }
    load();
  }, [isPaper, load]);

  const handlePartialClose = useCallback(async (pos, size) => {
    if (isPaper) {
      const res = await api.post("/paper/partial-close/" + pos._id, { size });
      load();
      return res.data;
    } else {
      const res = await api.post("/trading/close", { symbol: pos.symbol, size, side: pos.side });
      load();
      return res.data;
    }
  }, [isPaper, load]);

  const handleAddToPosition = useCallback(async (posId, size) => {
    const res = await api.post("/paper/add/" + posId, { size });
    load();
    return res.data;
  }, [load]);

  const handleResetBalance = useCallback(async (balanceAmount) => {
    await api.post("/paper/reset", { balance: balanceAmount });
    load();
    loadHistory(1);
  }, [load, loadHistory]);

  const handleCancelOrder = useCallback(async (orderId, symbol) => {
    try {
      if (isPaper) {
        await api.delete(`/paper/order/${orderId}`);
      } else {
        await api.delete(`/trading/order/${orderId}?symbol=${symbol}`);
      }
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || e.message);
    }
  }, [isPaper, load]);

  const handleEditOrder = useCallback(async (data) => {
    if (isPaper) {
      await api.put("/paper/order", data);
    } else {
      await api.put("/trading/order", data);
    }
    load();
  }, [isPaper, load]);


  const totalUnrealised = positions.reduce((s, p) => {
    if (isPaper) {
      // Paper positions already have unrealisedPnl calculated by the engine (accounting for leverage/contract size)
      return s + (p.unrealisedPnl != null ? p.unrealisedPnl : 0);
    }
    // Live mode: use unrealisedPnl from Delta API, fall back to raw mark price calc
    const mark = livePrices[p.symbol] != null ? livePrices[p.symbol] : p.markPrice != null ? p.markPrice : p.entryPrice;
    return s + (p.unrealisedPnl != null ? p.unrealisedPnl : (p.side === "buy" ? mark - p.entryPrice : p.entryPrice - mark) * p.size);
  }, 0);

  return (
    <div className="min-h-screen bg-crypto-bg">
      <div className="sticky top-0 z-20 bg-crypto-card/90 backdrop-blur-lg border-b border-crypto-border">
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading transition-colors cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-crypto-heading">Positions</h1>
                <div className={"w-1.5 h-1.5 rounded-full animate-live-dot " + (isPaper ? "bg-yellow-400" : "bg-emerald-400")} />
                <span className={"text-xs font-semibold " + (isPaper ? "text-yellow-400" : "text-emerald-400")}>{isPaper ? "Paper" : "Live"}</span>
              </div>
              <p className="text-xs text-crypto-muted">{isPaper ? "Simulated · Mark prices from live feed" : "Delta Exchange · Real-time"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPaper && (
              <button onClick={() => setResetOpen(true)} className="px-3 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-bold hover:bg-red-500/20 transition-all cursor-pointer flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6.5" /></svg>
                <span className="hidden sm:inline">Reset Balance</span>
              </button>
            )}
            {positions.length > 0 && (
              <div className={"text-xs font-semibold px-3 py-1 rounded-full border hidden sm:block " + (totalUnrealised >= 0 ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-red-400 bg-red-400/10 border-red-400/20")}>
                {totalUnrealised >= 0 ? "+" : ""}{fmtP(totalUnrealised)} uPnL
              </div>
            )}
            <button onClick={() => setTradeOpen(true)} className="px-3 sm:px-4 py-2 bg-crypto-primary text-white rounded-xl text-sm font-bold hover:bg-crypto-primary/90 transition-all cursor-pointer flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              <span className="hidden sm:inline">New Order</span>
            </button>
            <NotificationBell />
          </div>
        </div>
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 pb-2 flex gap-1 overflow-x-auto no-scrollbar">
          {[
            { key: "positions", label: "Open (" + positions.length + ")" },
            { key: "orders", label: "Orders (" + openOrders.length + ")" },
            { key: "history", label: "History (" + histTotal + ")" }
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={"px-3 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all cursor-pointer whitespace-nowrap " + (tab === t.key ? "bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20" : "text-crypto-muted hover:text-crypto-heading hover:bg-crypto-bg-subtle")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-3 md:py-5 pb-24 md:pb-5 space-y-3 md:space-y-5">
        <WalletBanner 
          wallet={wallet && isPaper ? {
            ...wallet,
            unrealisedPnl: totalUnrealised,
            equity: (wallet.available || 0) + (wallet.used || 0) + totalUnrealised,
          } : wallet} 
          isPaper={isPaper} 
        />

        {tab === "positions" && (
          loading ? (
            <div className="bg-crypto-card border border-crypto-border rounded-2xl p-8 text-center">
              <div className="w-8 h-8 border-2 border-crypto-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-crypto-muted">Loading positions…</p>
            </div>
          ) : positions.length === 0 ? (
            <div className="bg-crypto-card border border-crypto-border rounded-2xl p-12 text-center">
              <h3 className="text-base font-semibold text-crypto-heading mb-1">No open positions</h3>
              <p className="text-sm text-crypto-muted max-w-xs mx-auto mb-4">Go to AI Signals for setups, or open a manual order.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => navigate("/signals")} className="px-4 py-2 bg-crypto-primary/10 text-crypto-primary border border-crypto-primary/20 rounded-lg text-sm font-semibold hover:bg-crypto-primary/20 cursor-pointer">View AI Signals</button>
                <button onClick={() => setTradeOpen(true)} className="px-4 py-2 bg-crypto-primary text-white rounded-lg text-sm font-semibold hover:bg-crypto-primary/90 cursor-pointer">New Order</button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {positions.map((pos) => (
                <PositionCard key={pos._id || pos.symbol} pos={pos} livePrices={livePrices}
                  onClose={handleClosePosition} onModify={handleModify} onPartialClose={handlePartialClose}
                  onAdd={handleAddToPosition} isPaper={isPaper} />
              ))}
            </div>
          )
        )}

        {tab === "orders" && (
          <div className="bg-crypto-card border border-crypto-border rounded-2xl overflow-hidden">
            {openOrders.length === 0 ? (
              <div className="p-12 text-center"><p className="text-sm text-crypto-muted">No open orders.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-medium">
                  <thead>
                    <tr className="border-b border-crypto-border bg-crypto-bg-subtle">
                      {["Side/Time", "Symbol", "Type", "Size", "Price", "Action"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] text-crypto-muted uppercase tracking-wider font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.map((o) => {
                      const isBuy = o.side === "buy";
                      const orderTypeDisplay = o.stopOrderType
                        ? o.stopOrderType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                        : o.orderType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                      return (
                        <tr key={o.id} className="border-b border-crypto-border/40 hover:bg-crypto-bg-subtle/50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className={"text-xs font-bold " + (isBuy ? "text-emerald-400" : "text-red-400")}>{isBuy ? "BUY" : "SELL"}</div>
                            <div className="text-[10px] text-crypto-muted mt-0.5">{timeAgo(o.createdAt)}</div>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-crypto-heading">
                            <span
                              onClick={() => navigate(`/?coin=${o.symbol}`)}
                              className="hover:text-crypto-primary cursor-pointer transition-colors duration-150 inline-flex items-center gap-1 group/sym hover:underline decoration-crypto-primary/40 underline-offset-4"
                              title={`View ${o.symbol.replace("USD", "/USD")} Chart`}
                            >
                              {o.symbol.replace("USD", "/USD")}
                              <svg className="w-3.5 h-3.5 text-crypto-muted group-hover/sym:text-crypto-primary transition-colors duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                              </svg>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-crypto-muted">
                            <span className="bg-crypto-bg-subtle border border-crypto-border px-2 py-0.5 rounded-full font-semibold">{orderTypeDisplay}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-crypto-heading tabular-nums">
                            {o.size} <span className="text-[10px] text-crypto-muted font-normal">(Unfilled: {o.unfilledSize})</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-crypto-heading tabular-nums">
                            {o.stopPrice ? (
                              <div>
                                <span className="text-[9px] text-crypto-muted block uppercase tracking-wide">Trigger</span>
                                {fmtP(o.stopPrice)}
                              </div>
                            ) : o.limitPrice ? (
                              <div>
                                <span className="text-[9px] text-crypto-muted block uppercase tracking-wide">Limit</span>
                                {fmtP(o.limitPrice)}
                              </div>
                            ) : (
                              "Market"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => setEditingOrder(o)}
                                className="px-2.5 py-1 text-xs font-semibold bg-crypto-primary/10 border border-crypto-primary/20 text-crypto-primary rounded-lg hover:bg-crypto-primary/20 transition-all cursor-pointer"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleCancelOrder(o.id, o.symbol)}
                                className="px-2.5 py-1 text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 transition-all cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="bg-crypto-card border border-crypto-border rounded-2xl overflow-hidden">
            {history.length === 0 ? (
              <div className="p-12 text-center"><p className="text-sm text-crypto-muted">No trade history yet.</p></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-crypto-border bg-crypto-bg-subtle">
                        {["Side/Time", "Symbol", "Size", "Price", "Lev.", "Result", "PnL", "Note"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-[10px] text-crypto-muted uppercase tracking-wider font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>{history.map((t) => <HistoryRow key={t._id} trade={t} />)}</tbody>
                  </table>
                </div>
                {histTotal > 30 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-crypto-border">
                    <span className="text-xs text-crypto-muted">{histTotal} total</span>
                    <div className="flex gap-2">
                      <button onClick={() => loadHistory(histPage - 1)} disabled={histPage === 1} className="px-3 py-1 rounded-lg text-xs text-crypto-muted border border-crypto-border hover:text-crypto-heading disabled:opacity-30 cursor-pointer">← Prev</button>
                      <span className="px-3 py-1 text-xs text-crypto-heading">Page {histPage}</span>
                      <button onClick={() => loadHistory(histPage + 1)} disabled={histPage * 30 >= histTotal} className="px-3 py-1 rounded-lg text-xs text-crypto-muted border border-crypto-border hover:text-crypto-heading disabled:opacity-30 cursor-pointer">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <TradeConfirmDialog open={tradeOpen} onClose={() => setTradeOpen(false)} onSuccess={() => { load(); loadHistory(1); }} />
      {resetOpen && <ResetBalanceDialog onClose={() => setResetOpen(false)} onReset={handleResetBalance} />}
      {editingOrder && <EditOrderDialog order={editingOrder} onClose={() => setEditingOrder(null)} onSave={handleEditOrder} />}

      <MobileBottomNav />
    </div>
  );
};

export default Positions;
