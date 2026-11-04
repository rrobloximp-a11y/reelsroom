import { Link } from "react-router-dom";
import { useAuth } from "../auth";

/** Shown once when an admin has handed out coins to everyone (e.g. a Christmas present). */
export function GiftPopup() {
  const { gifts, dismissGifts, channel } = useAuth();
  if (!gifts.length || !channel) return null;
  const total = gifts.reduce((n, g) => n + g.amount, 0);
  const messages = gifts.map((g) => g.message).filter(Boolean);
  return (
    <div className="modal-backdrop" onClick={dismissGifts}>
      <div className="modal gift-modal pop" role="dialog" aria-labelledby="gift-title" onClick={(e) => e.stopPropagation()}>
        <div className="gift-art" aria-hidden>
          <span className="gift-box">🎁</span>
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className="gift-spark" style={{ ["--a" as string]: `${(i * 360) / 14}deg`, animationDelay: `${(i % 4) * 0.08}s` }}>
              {["✨", "❄", "⭐", "🪙"][i % 4]}
            </span>
          ))}
        </div>
        <span className="kicker">You got a present</span>
        <h2 id="gift-title" className="gift-amount">+{total.toLocaleString("en-US")} coins</h2>
        {messages.length > 0 ? (
          messages.map((m, i) => <p key={i} className="gift-message">“{m}”</p>)
        ) : (
          <p className="gift-message">A gift from the Reelroom team.</p>
        )}
        <p className="muted small">Your balance is now {channel.coins.toLocaleString("en-US")} coins. Spend them on decorations or promoting your videos.</p>
        <div className="row gift-actions">
          <Link to="/decorations" className="btn btn-accent" onClick={dismissGifts}>Shop decorations</Link>
          <button className="btn btn-ghost" onClick={dismissGifts}>Thanks!</button>
        </div>
      </div>
    </div>
  );
}
