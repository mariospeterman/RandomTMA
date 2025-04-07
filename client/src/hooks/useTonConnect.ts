// Ensure Buffer is available
import '../buffer';

import { CHAIN, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { Address } from "ton-core";

type SenderArguments = {
  to: { toString: () => string };
  value: { toString: () => string };
  body?: { toBoc: () => Buffer };
};

type Sender = {
  send: (args: SenderArguments) => Promise<void>;
  address?: Address;
};

export function useTonConnect(): {
  sender: Sender;
  connected: boolean;
  connecting: boolean;
  wallet: string | null;
  network: CHAIN | null;
  disconnect: () => Promise<void>;
  showWalletConnectModal: () => Promise<void>;
} {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  return {
    sender: {
      send: async (args: SenderArguments) => {
        await tonConnectUI.sendTransaction({
          messages: [
            {
              address: args.to.toString(),
              amount: args.value.toString(),
              payload: args.body?.toBoc().toString("base64"),
            },
          ],
          validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes for user to approve
        });
      },
      address: wallet?.account?.address ? Address.parse(wallet?.account?.address as string) : undefined
    },

    connected: !!wallet?.account.address,
    connecting: false, // We don't have a proper way to check connecting state
    wallet: wallet?.account.address ?? null,
    network: wallet?.account.chain ?? null,
    disconnect: async () => {
      await tonConnectUI.disconnect();
    },
    showWalletConnectModal: async () => {
      await tonConnectUI.openModal();
    }
  };
}