/**
 * Webhook receiver + send message routes.
 */
import { Router, type Request, type Response } from "express";
import type { ChannelRegistry } from "../../channels/registry";
import type { AgentBridge } from "../../core/bridge";
import { Logger } from "../../utils/logger";

export interface WebhookRouteOptions {
  channelRegistry: ChannelRegistry;
  bridge: AgentBridge;
  logLevel?: string;
}

export function webhookRoutes(opts: WebhookRouteOptions): Router {
  const router = Router();
  const logger = new Logger("Webhooks", opts.logLevel);

  // Webhook receiver for any channel
  router.post("/webhook/:channelId", async (req: Request, res: Response) => {
    const channelId = req.params.channelId as string;
    res.sendStatus(200); // Respond fast

    const instance = opts.channelRegistry.getInstance(channelId);
    if (!instance) {
      logger.warn(`Webhook for unknown channel: ${channelId}`);
      return;
    }

    if ("handleWebhookUpdate" in instance && typeof (instance as any).handleWebhookUpdate === "function") {
      try {
        await (instance as any).handleWebhookUpdate(req.body);
      } catch (err) {
        logger.error(`Webhook error (${channelId}): ${err}`);
      }
    }
  });

  // Send message via API
  router.post("/api/send", async (req: Request, res: Response) => {
    const { channel, chatId, text } = req.body;
    if (!channel || !chatId || !text) {
      res.status(400).json({ error: "channel, chatId, and text are required" });
      return;
    }

    const adapter = opts.channelRegistry.getInstance(channel);
    if (!adapter) {
      res.status(404).json({ error: `Channel "${channel}" not running` });
      return;
    }

    try {
      await opts.bridge.handleMessage({
        messageId: "0",
        chatId: String(chatId),
        userId: String(chatId),
        username: "api",
        text: String(text),
        channel: String(channel),
        isGroup: false,
        timestamp: Date.now(),
      }, adapter);
      res.json({ success: true });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
