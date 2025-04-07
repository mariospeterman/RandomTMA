// Ensure Buffer is available
import '../buffer';

import { getHttpEndpoint } from "@orbs-network/ton-access";
import { CHAIN } from "@tonconnect/ui-react";
import { TonClient } from "ton";
import { useAsyncInitialize } from "./useAsyncInitialize";
import { useTonConnect } from "./useTonConnect";

export function useTonClient() {
    const { network } = useTonConnect();

    const initialize = async () => {
        if (!network) return;

        return new TonClient({
            endpoint: await getHttpEndpoint({
                network: network === CHAIN.MAINNET ? "mainnet" : "testnet"
            })
        });
    };

    return {
        client: useAsyncInitialize(initialize, [network])
    };
}