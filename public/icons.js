const ICON_LIB = {
  door_interior: '<rect x="18" y="6" width="28" height="52" rx="1"/><path d="M12 58 L52 58"/><circle cx="41" cy="33" r="1.8" fill="currentColor" stroke="none"/><rect x="24" y="12" width="16" height="16"/><rect x="24" y="34" width="16" height="18"/>',
  door_enamel: '<rect x="18" y="6" width="28" height="52" rx="1"/><path d="M12 58 L52 58"/><path d="M38 33 L43 33"/><path d="M24 12 L24 52"/>',
  door_metal: '<rect x="16" y="6" width="32" height="52" rx="1"/><rect x="21" y="11" width="22" height="42"/><path d="M40 28 L40 36"/><circle cx="40" cy="41" r="1.4" fill="currentColor" stroke="none"/><path d="M10 58 L54 58"/>',
  frame: '<path d="M14 58 L14 8 L50 8 L50 58"/><path d="M20 58 L20 14 L44 14 L44 58"/>',
  casing: '<path d="M8 24 L56 24 L56 34 L8 34 Z"/><path d="M8 34 L8 42 L54 42 Q56 38 56 34"/>',
  extension: '<rect x="8" y="18" width="48" height="8"/><rect x="8" y="30" width="48" height="12"/><rect x="8" y="46" width="48" height="4"/>',
  handle: '<rect x="12" y="20" width="12" height="24" rx="6"/><path d="M18 32 L52 32"/><path d="M52 28 L52 36"/>',
  hinge: '<rect x="14" y="12" width="14" height="40" rx="2"/><rect x="36" y="12" width="14" height="40" rx="2"/><path d="M32 8 L32 56"/>',
  threshold: '<path d="M6 42 L18 32 L46 32 L58 42 Z"/>',
  foam_gun: '<path d="M10 30 L10 54"/><path d="M6 30 L14 30"/><rect x="7" y="16" width="14" height="14" rx="2"/><path d="M21 20 L34 20"/><path d="M34 12 L52 12 L52 26"/><path d="M34 20 L46 20"/><path d="M40 6 L40 12"/>',
  foam_cloud: '<path d="M8 44 L8 54 L20 54 L20 44 Z"/><path d="M6 44 L22 44 L22 38 L6 38 Z"/><path d="M10 38 L10 30 L18 30 L18 38"/><circle cx="34" cy="26" r="7"/><circle cx="43" cy="20" r="6"/><circle cx="46" cy="31" r="5.5"/><circle cx="37" cy="35" r="4.5"/>',
  caulk_gun: '<path d="M6 40 L6 46 L14 46 L18 40 Z"/><path d="M18 40 L18 20 L48 20 L48 26 L58 26 L58 34 L48 34 L48 40 Z"/><path d="M18 28 L10 28 L10 40"/><circle cx="12" cy="34" r="2" fill="currentColor" stroke="none"/>',
  glue_tube: '<rect x="8" y="42" width="34" height="9" rx="1.5"/><path d="M42 40 L54 24"/><path d="M50 18 L58 26"/><path d="M53 21 L47 27"/><circle cx="16" cy="46.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="24" cy="46.5" r="1.6" fill="currentColor" stroke="none"/>',
  trowel_steps: '<path d="M8 54 L8 46 L20 46 L20 38 L32 38 L32 30 L44 30 L44 22 L56 22"/><path d="M50 10 L58 18"/><path d="M54 8 L60 14"/><circle cx="48" cy="12" r="3"/>',
  paint_bucket: '<path d="M12 24 L52 24 L47 56 L17 56 Z"/><path d="M12 24 L8 16 L56 16 L52 24"/><path d="M22 32 L26 32 C26 36 30 36 30 40 C30 44 26 44 26 48"/>',
  paint_roller: '<rect x="10" y="14" width="30" height="16" rx="3"/><path d="M25 30 L25 40"/><rect x="19" y="40" width="12" height="16" rx="2"/><path d="M40 18 L48 18 L48 26 L40 26"/>',
  insulation: '<rect x="8" y="14" width="48" height="36" rx="2"/><path d="M8 24 L56 24"/><path d="M8 34 L56 34"/><path d="M8 44 L56 44"/><path d="M18 14 L18 24"/><path d="M32 24 L32 34"/><path d="M46 34 L46 44"/>',
  box: '<rect x="12" y="12" width="40" height="40" rx="4"/><path d="M12 26 L52 26"/>',
  drop: '<path d="M32 8 C40 22 48 30 48 40 A16 16 0 0 1 16 40 C16 30 24 22 32 8 Z"/>',
  brush: '<path d="M20 12 L44 12 L44 24 L36 32 L36 54 L28 54 L28 32 L20 24 Z"/><path d="M20 20 L44 20"/>',
  tape: '<circle cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="8"/>',
  wood: '<rect x="10" y="24" width="44" height="16" rx="2"/><path d="M10 32 L54 32"/><circle cx="18" cy="32" r="1.6" fill="currentColor" stroke="none"/><circle cx="46" cy="32" r="1.6" fill="currentColor" stroke="none"/>',
};

const ICON_CHOICES = ['door_interior','door_enamel','door_metal','frame','casing','extension','handle','hinge','threshold','foam_gun','foam_cloud','caulk_gun','glue_tube','trowel_steps','paint_bucket','paint_roller','insulation','drop','brush','tape','wood','box'];

function iconSvg(key, cls) {
  const p = ICON_LIB[key] || ICON_LIB.box;
  return `<svg viewBox="0 0 64 64" class="${cls || ''}">${p}</svg>`;
}
