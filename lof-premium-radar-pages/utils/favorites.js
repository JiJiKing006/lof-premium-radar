const WATCH_STORAGE_KEY = 'fund-watchlist';

function loadFavoriteCodes() {
  try {
    const parsed = JSON.parse(wx.getStorageSync(WATCH_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function storeFavoriteCodes(codes) {
  wx.setStorageSync(WATCH_STORAGE_KEY, JSON.stringify(codes));
}

module.exports = { loadFavoriteCodes, storeFavoriteCodes };
