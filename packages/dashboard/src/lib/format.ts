const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function shortPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
