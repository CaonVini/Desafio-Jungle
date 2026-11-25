import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { asObject, readMoney, readUuid } from "../../shared/http/payload-parser";
import { CreateWalletUseCase } from "../application/create-wallet.use-case";
import { GetWalletUseCase } from "../application/get-wallet.use-case";
import { WalletOutput } from "../application/wallet.output";

@Controller("wallets")
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): Promise<WalletOutput> {
    const source = asObject(body);
    return this.createWallet.execute({
      playerId: readUuid(source, "playerId"),
      initialBalance: readMoney(source, "initialBalance"),
    });
  }

  @Get(":walletId")
  get(@Param("walletId") walletId: string): Promise<WalletOutput> {
    return this.getWallet.execute(readUuid({ walletId }, "walletId"));
  }
}