"use client";

import { useEffect, useState } from "react";
import { Radio, CheckCircle2, XCircle, Send } from "lucide-react";
import { fetchChannels, sendMessage, type ChannelItem } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendForm, setSendForm] = useState<{ channel: string; chatId: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchChannels();
        if (mounted) setChannels(data.channels);
      } catch { /* ignore */ }
      if (mounted) setLoading(false);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const handleSend = async () => {
    if (!sendForm || !sendForm.chatId || !sendForm.text) return;
    setSending(true);
    setSendResult(null);
    try {
      await sendMessage(sendForm.channel, sendForm.chatId, sendForm.text);
      setSendResult("Message sent successfully");
      setSendForm(null);
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Failed to send");
    }
    setSending(false);
  };

  return (
    <div>
      <PageHeader title="Channels" description="Channel connections and status" />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-6 bg-gray-800 rounded w-32 mb-3" />
              <div className="h-4 bg-gray-800 rounded w-48" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="card text-center py-12">
          <Radio className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No channels registered</p>
          <p className="text-gray-600 text-sm mt-1">Configure channels in remote-coding-agent.config.json</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {channels.map((ch) => (
            <div key={ch.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    ch.running ? "bg-emerald-500/10" : "bg-gray-800"
                  }`}>
                    <Radio className={`w-5 h-5 ${ch.running ? "text-emerald-400" : "text-gray-600"}`} />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{ch.name}</h3>
                    <p className="text-xs text-gray-500">{ch.id}</p>
                  </div>
                </div>
                {ch.running ? (
                  <span className="badge-green flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <span className="badge-red flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Offline
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-400 mb-4">{ch.description}</p>

              {ch.running && (
                <div className="border-t border-gray-800 pt-4">
                  {sendForm?.channel === ch.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Chat ID"
                        className="input-field"
                        value={sendForm.chatId}
                        onChange={(e) => setSendForm({ ...sendForm, chatId: e.target.value })}
                      />
                      <textarea
                        placeholder="Message text..."
                        className="input-field min-h-[80px] resize-y"
                        value={sendForm.text}
                        onChange={(e) => setSendForm({ ...sendForm, text: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button onClick={handleSend} disabled={sending} className="btn-primary flex items-center gap-2">
                          <Send className="w-3 h-3" /> {sending ? "Sending..." : "Send"}
                        </button>
                        <button onClick={() => setSendForm(null)} className="btn-secondary">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSendForm({ channel: ch.id, chatId: "", text: "" })}
                      className="btn-secondary flex items-center gap-2 text-xs"
                    >
                      <Send className="w-3 h-3" /> Send Message via API
                    </button>
                  )}
                </div>
              )}

              {ch.configSchema && (
                <div className="border-t border-gray-800 pt-4 mt-4">
                  <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Config Schema</h4>
                  <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-x-auto">
                    {JSON.stringify(ch.configSchema, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sendResult && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${
          sendResult.includes("success") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {sendResult}
        </div>
      )}
    </div>
  );
}
