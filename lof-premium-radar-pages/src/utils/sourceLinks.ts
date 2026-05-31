import type { FundType } from '../types/fund';

const PALMMICRO_LOF_URL = 'https://palmmicro.com/woody/res/lofcn.php?sort=premium';
const EASTMONEY_FUND_HOME = 'https://fund.eastmoney.com/';
const JISILU_LOF_URL = 'https://www.jisilu.cn/data/lof/';
const JISILU_QDII_URL = 'https://www.jisilu.cn/data/qdii/';
const HAOETF_URL = 'https://www.haoetf.com/';
const SINA_FUND_URL = 'https://finance.sina.com.cn/fund/';
const AKSHARE_URL = 'https://akshare.akfamily.xyz/';
const SSE_FUND_SCALE_URL = 'https://www.sse.com.cn/market/funddata/volumn/etfvolumn/';
const SZSE_ETF_LIST_URL = 'https://www.szse.cn/market/product/fund/etf/etfList/index.html';

export interface SourceReference {
  label: string;
  url: string;
}

export function sourceLabel(source: unknown): string {
  const raw = String(source || '').trim();
  const text = raw.toLowerCase();
  if (!raw) return '';
  if (text.includes('eastmoney')) return '东方财富';
  if (text.includes('tiantian')) return '天天基金';
  if (text.includes('jisilu')) return '集思录';
  if (text.includes('haoetf')) return 'HaoETF';
  if (text.includes('palmmicro') || text === 'lof') return 'Palmmicro';
  if (text.includes('sina')) return '新浪财经';
  if (text.includes('akshare')) return 'AkShare';
  if (text === 'sse' || text.includes('sse-share')) return '上交所';
  if (text === 'szse' || text.includes('szse-share')) return '深交所';
  if (text === 'cache') return '缓存';
  if (text === 'internal') return '内部聚合';
  return raw;
}

export function sourceReference(source: unknown, code?: string, type?: FundType | string): SourceReference | null {
  const raw = String(source || '').trim();
  const text = raw.toLowerCase();
  const fundCode = String(code || '').replace(/^(SH|SZ)/i, '');
  if (!raw || text === 'cache' || text === 'internal' || /样式预览|暂无数据/.test(raw)) return null;

  if (text.includes('eastmoney') || text.includes('tiantian')) {
    return {
      label: sourceLabel(raw),
      url: fundCode ? `${EASTMONEY_FUND_HOME}${fundCode}.html` : EASTMONEY_FUND_HOME,
    };
  }

  if (text.includes('jisilu')) {
    return {
      label: sourceLabel(raw),
      url: String(type || '').toUpperCase() === 'QDII' ? JISILU_QDII_URL : JISILU_LOF_URL,
    };
  }

  if (text.includes('haoetf')) return { label: sourceLabel(raw), url: HAOETF_URL };
  if (text.includes('palmmicro') || text === 'lof') return { label: sourceLabel(raw), url: PALMMICRO_LOF_URL };
  if (text.includes('sina')) return { label: sourceLabel(raw), url: SINA_FUND_URL };
  if (text.includes('akshare')) return { label: sourceLabel(raw), url: AKSHARE_URL };
  if (text === 'sse' || text.includes('sse-share')) return { label: sourceLabel(raw), url: SSE_FUND_SCALE_URL };
  if (text === 'szse' || text.includes('szse-share')) return { label: sourceLabel(raw), url: SZSE_ETF_LIST_URL };

  return null;
}
