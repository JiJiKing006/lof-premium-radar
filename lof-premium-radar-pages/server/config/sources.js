export const sources = {
  lof: {
    id: 'lof',
    title: 'LOF基金',
    type: 'lof',
    url: 'https://palmmicro.com/woody/res/lofcn.php?sort=premium',
    refreshMs: 60_000,
  },
  qdii: {
    id: 'qdii',
    title: 'QDII基金',
    type: 'jisilu-qdii',
    refreshMs: 60_000,
    endpoints: {
      europe: 'https://www.jisilu.cn/data/qdii/qdii_list/E',
      asia: 'https://www.jisilu.cn/data/qdii/qdii_list/A',
      commodity: 'https://www.jisilu.cn/data/qdii/qdii_list/C',
    },
  },
  nasdaq100: {
    id: 'nasdaq100',
    title: '纳斯达克100',
    type: 'jisilu-qdii-filter',
    refreshMs: 60_000,
  },
};
