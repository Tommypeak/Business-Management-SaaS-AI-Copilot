import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, isUUID } from 'class-validator';
import { Permission, type AiSource } from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { ReturnsAnalyticsService } from '../analytics/returns-analytics.service.js';
import { AnalyticsQueryDto } from '../analytics/analytics.dto.js';
import { analyticsContext } from '../analytics/analytics-query.js';
import { SalesAnalyticsService } from '../analytics/sales-analytics.service.js';
import { InventoryAnalyticsService } from '../analytics/inventory-analytics.service.js';
import { PurchasingAnalyticsService } from '../analytics/purchasing-analytics.service.js';
import { FinanceAnalyticsService } from '../analytics/finance-analytics.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { AccountsPayableQueryService } from '../accounts-payable/query.service.js';
import { InventoryStockService } from '../inventory/stock.service.js';
import { AiAccessService } from './ai-access.service.js';
import { AI_TOOLS } from './ai-tools.js';
import { aiError } from './ai.config.js';
import { isObject } from './ai-provider.client.js';

type SalesSummary = Awaited<ReturnType<SalesAnalyticsService['summary']>>;
type InventorySummary = Awaited<ReturnType<InventoryAnalyticsService['summary']>>;
type PurchasingSummary = Awaited<ReturnType<PurchasingAnalyticsService['summary']>>;
type FinanceSummary = Awaited<ReturnType<FinanceService['summary']>>;
export type AiToolData =
  | Awaited<ReturnType<ReturnsAnalyticsService['summary']>>
  | (Awaited<ReturnType<AnalyticsService['overview']>> & {
      finance: FinanceSummary | { status: 'FORBIDDEN' };
    })
  | {
      context: SalesSummary['context'];
      currencyCode: SalesSummary['currencyCode'];
      salesAmount: SalesSummary['sales']['currentValue'];
      completedOrdersCount: SalesSummary['orders']['currentValue'];
      averageOrderValue: SalesSummary['averageOrderValue'];
      comparison: { sales: SalesSummary['sales']; orders: SalesSummary['orders'] } | null;
    }
  | Awaited<ReturnType<SalesAnalyticsService['trend']>>
  | Awaited<ReturnType<SalesAnalyticsService['top']>>
  | (Pick<
      InventorySummary,
      | 'trackedVariants'
      | 'zeroStock'
      | 'negativeStock'
      | 'negativeLocationBalances'
      | 'archivedNonZeroVariants'
    > & {
      warnings: Awaited<ReturnType<InventoryAnalyticsService['warnings']>>;
      asOf: string;
      locationId: string | null;
    })
  | Awaited<ReturnType<InventoryStockService['variant']>>
  | (Pick<
      PurchasingSummary,
      | 'context'
      | 'currencyCode'
      | 'orderedAmount'
      | 'purchaseOrdersCount'
      | 'openOrders'
      | 'partiallyReceivedOrders'
      | 'fullyReceivedOrders'
      | 'receivingProgressPercentage'
    > & {
      receivingLines: Awaited<ReturnType<PurchasingAnalyticsService['receiving']>>;
    })
  | FinanceSummary
  | Awaited<ReturnType<FinanceAnalyticsService['cashFlow']>>
  | Awaited<ReturnType<AccountsPayableQueryService['summary']>>;

@Injectable()
export class AiToolsService {
  private readonly logger = new Logger(AiToolsService.name);
  constructor(
    private readonly access: AiAccessService,
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly sales: SalesAnalyticsService,
    private readonly inventory: InventoryAnalyticsService,
    private readonly purchasing: PurchasingAnalyticsService,
    private readonly finance: FinanceService,
    private readonly cash: FinanceAnalyticsService,
    private readonly ap: AccountsPayableQueryService,
    private readonly stock: InventoryStockService,
    private readonly returns: ReturnsAnalyticsService,
  ) {}
  async execute(org: string, user: string, name: string, json: string, requestId: string) {
    const start = Date.now();
    const tool = AI_TOOLS.find((t) => t.name === name);
    if (!tool) aiError('AI_UNKNOWN_TOOL', 400);
    const permissions = await this.access.permissions(org, user, [
      Permission.AI_USE,
      ...tool.permissions,
    ]);
    await this.access.enabled(org);
    let args: unknown;
    try {
      args = JSON.parse(json);
    } catch {
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    }
    if (!isObject(args) || Object.keys(args).some((k) => !tool.fields.some((f) => f === k)))
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    if (
      args.variantId !== undefined &&
      (typeof args.variantId !== 'string' || !isUUID(args.variantId))
    )
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    if (name === 'get_variant_stock' && !args.variantId) aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    if (
      args.comparePrevious !== undefined &&
      args.comparePrevious !== null &&
      typeof args.comparePrevious !== 'boolean'
    )
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    if (
      args.limit !== undefined &&
      args.limit !== null &&
      (typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 20)
    )
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    const values = Object.fromEntries(
      Object.entries(args).filter(
        ([k, v]) => !['variantId', 'comparePrevious'].includes(k) && v !== null,
      ),
    );
    const query = plainToInstance(AnalyticsQueryDto, { ...values, limit: values.limit ?? 10 });
    if ((await validate(query, { whitelist: true, forbidNonWhitelisted: true })).length)
      aiError('AI_INVALID_TOOL_ARGUMENTS', 400);
    const c = await analyticsContext(this.prisma, org, query);
    Object.assign(query, { from: c.from, to: c.to });
    let data: AiToolData;
    switch (name) {
      case 'get_customer_returns_summary':
        data = await this.returns.summary(
          org,
          query,
          permissions.includes(Permission.FINANCE_VIEW),
        );
        break;
      case 'get_business_overview':
        data = {
          ...(await this.analytics.overview(org, query)),
          finance: permissions.includes(Permission.FINANCE_VIEW)
            ? await this.finance.summary(org, query)
            : { status: 'FORBIDDEN' },
        };
        break;
      case 'get_sales_summary': {
        const r = await this.sales.summary(org, query);
        data = {
          context: r.context,
          currencyCode: r.currencyCode,
          salesAmount: r.sales.currentValue,
          completedOrdersCount: r.orders.currentValue,
          averageOrderValue: r.averageOrderValue,
          comparison: args.comparePrevious === false ? null : { sales: r.sales, orders: r.orders },
        };
        break;
      }
      case 'get_sales_trend':
        data = await this.sales.trend(org, query);
        break;
      case 'get_top_selling_variants':
        data = await this.sales.top(org, query);
        break;
      case 'get_inventory_summary': {
        const r = await this.inventory.summary(org, query);
        data = {
          trackedVariants: r.trackedVariants,
          zeroStock: r.zeroStock,
          negativeStock: r.negativeStock,
          negativeLocationBalances: r.negativeLocationBalances,
          archivedNonZeroVariants: r.archivedNonZeroVariants,
          warnings: await this.inventory.warnings(org, query),
          asOf: new Date().toISOString(),
          locationId: query.locationId ?? null,
        };
        break;
      }
      case 'get_variant_stock':
        data = await this.stock.variant(org, args.variantId as string, query.locationId);
        break;
      case 'get_purchasing_summary': {
        const r = await this.purchasing.summary(org, query);
        data = {
          context: r.context,
          currencyCode: r.currencyCode,
          orderedAmount: r.orderedAmount,
          purchaseOrdersCount: r.purchaseOrdersCount,
          openOrders: r.openOrders,
          partiallyReceivedOrders: r.partiallyReceivedOrders,
          fullyReceivedOrders: r.fullyReceivedOrders,
          receivingProgressPercentage: r.receivingProgressPercentage,
          receivingLines: await this.purchasing.receiving(org, { ...query, limit: 20 }),
        };
        break;
      }
      case 'get_finance_summary':
        data = await this.finance.summary(org, query);
        break;
      case 'get_cash_flow_trend':
        data = await this.cash.cashFlow(org, query);
        break;
      case 'get_accounts_payable_summary':
        data = await this.ap.summary(org);
        break;
      default:
        aiError('AI_UNKNOWN_TOOL', 400);
    }
    // Recheck before releasing data, including permission removals during a DB query.
    await this.access.permissions(org, user, permissions);
    await this.access.enabled(org);
    const source: AiSource = {
      tool: name,
      label: tool.label,
      href: `/app/${org}/${tool.route}`,
      refreshedAt: new Date().toISOString(),
    };
    const params = new URLSearchParams();
    if (tool.fields.includes('from')) {
      source.from = c.from;
      source.to = c.to;
      params.set('from', c.from);
      params.set('to', c.to);
    }
    if (query.locationId) {
      source.locationId = query.locationId;
      params.set('locationId', query.locationId);
    }
    if (params.size) source.href += `?${params}`;
    if (isObject(data) && 'currencyCode' in data && typeof data.currencyCode === 'string')
      source.currencyCode = data.currencyCode;
    if (Array.isArray(data) && isObject(data[0]) && typeof data[0].currencyCode === 'string')
      source.currencyCode = data[0].currencyCode;
    if (JSON.stringify(data).length > 24000) aiError('AI_TOOL_RESULT_TOO_LARGE', 400);
    this.logger.log({
      requestId,
      organizationId: org,
      userId: user,
      toolName: name,
      latency: Date.now() - start,
      status: 'completed',
    });
    return { source, data, trust: 'UNTRUSTED_BUSINESS_DATA' as const };
  }
}
