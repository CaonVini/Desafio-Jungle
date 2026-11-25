import { MoneyProps } from "../../shared/domain/money";
import { Wallet } from "../domain/wallet";

export interface WalletOutput {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export function toWalletOutput(wallet: Wallet): WalletOutput {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}