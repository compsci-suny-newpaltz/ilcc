export const ADDRESS_COUNT = 0x10000;
export const ROW_HEIGHT = 22;
export const OVERSCAN = 12;

export function scrollAddressIntoView(content, address, behavior = 'smooth') {
  if (!content || address == null) return;
  const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
  content.scrollTo({ top: Math.min(address * ROW_HEIGHT, maxScroll), behavior });
}
