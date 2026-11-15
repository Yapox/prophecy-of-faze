export const operatorName = import.meta.env.VITE_OPERATOR_NAME?.trim() || '';
const email = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || '';
export const supportEmail = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) ? email : '';
