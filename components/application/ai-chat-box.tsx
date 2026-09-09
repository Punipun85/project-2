"use client";
/* eslint-disable @next/next/no-img-element */

import { Bot, Send, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import Link from "next/link";

type Message = { role: "assistant" | "user"; text: string };
type AIRecommendation = {
  id: string;
  title: string;
  poster?: string;
  type?: string;
  score?: number;
  reason: string;
};

export function AIChatBox() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Tell me a title, mood, theme, or character you want to discover." },
  ]);
  const [results, setResults] = useState<AIRecommendation[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setInput("");
    setLoading(true);
    setMessages((current) => [...current, { role: "user", text: message }]);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error("chat failed");
      const payload = (await response.json()) as {
        answer: string;
        recommendations: AIRecommendation[];
      };
      setMessages((current) => [...current, { role: "assistant", text: payload.answer }]);
      setResults(Array.isArray(payload.recommendations) ? payload.recommendations : []);
      void fetch("/api/user/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventType: "chat", metadata: { query: message } }),
      });
    } catch {
      setMessages((current) => [...current, { role: "assistant", text: "I could not reach the assistant. Try the semantic search while I reconnect." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="batch4-chat">
      <header><span><Sparkles size={18} /></span><div><h2>Lumi AI</h2><p>Grounded entertainment assistant</p></div></header>
      <div className="batch4-messages">
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}><span>{message.role === "assistant" ? <Bot size={14} /> : "YOU"}</span><p>{message.text}</p></div>)}
        {loading && <div className="message assistant"><span><Bot size={14} /></span><p>Searching your entertainment universe…</p></div>}
      </div>
      {results.length > 0 && <div className="batch4-chat-results">{results.map((item) => <Link href={`/content/${encodeURIComponent(item.id)}`} key={item.id}>{item.poster && <img src={item.poster} alt="" />}<span><b>{item.title}</b><small>{item.reason}</small></span></Link>)}</div>}
      <div className="prompt-chips"><button onClick={() => setInput("Find anime like Attack on Titan")}>Like Attack on Titan</button><button onClick={() => setInput("Movie with genius protagonist")}>Genius protagonist</button><button onClick={() => setInput("Sad romantic drama")}>Sad romance</button></div>
      <form className="assistant-form" onSubmit={submit}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Lumi anything…" aria-label="Ask Lumi" /><button aria-label="Send"><Send size={15} /></button></form>
    </section>
  );
}
