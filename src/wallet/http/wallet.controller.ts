import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { asObject, readMoney, readUuid } from "../../shared/http/payload-parser";
import { CreateWalletUseCase } from "../application/create-wallet.use-case";
import { GetWalletUseCase } from "../application/get-wallet.use-case";
import {
  DEFAULT_LEDGER_LIMIT,
  LedgerPageOutput,
  ListLedgerUseCase,
  MAX_LEDGER_LIMIT,
} from "../application/list-ledger.use-case";
import {
  ReconcileWalletUseCase,
  ReconciliationOutput,
} from "../application/reconcile-wallet.use-case";
import { WalletOutput } from "../application/wallet.output";

@Controller("wallets")
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
    private readonly listLedger: ListLedgerUseCase,
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

  @Get(":walletId/ledger")
  ledger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
  ): Promise<LedgerPageOutput> {
    return this.listLedger.execute({
      walletId: readUuid({ walletId }, "walletId"),
      cursor: readOptionalCursor(cursor),
      limit: readLimit(limit),
    });
  }

  @Post(":walletId/reconciliation")
  @HttpCode(200)
  reconcile(@Param("walletId") walletId: string): Promise<ReconciliationOutput> {
    return this.reconcileWallet.execute(readUuid({ walletId }, "walletId"));
  }
}

function readOptionalCursor(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new DomainError("cursor is invalid", "INVALID_PAYLOAD");
  }
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LEDGER_LIMIT;
  }
  const limit = typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!(limit >= 1 && limit <= MAX_LEDGER_LIMIT)) {
    throw new DomainError(
      `limit must be an integer between 1 and ${MAX_LEDGER_LIMIT}`,
      "INVALID_PAYLOAD",
    );
  }
  return limit;
}
