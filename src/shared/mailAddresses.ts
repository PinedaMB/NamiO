export function splitRecipients(value: string): string[] {
  return value.split(/[,;]/).map(address => address.trim()).filter(Boolean)
}

export function validRecipients(...values: string[]): boolean {
  const addresses = values.flatMap(splitRecipients)
  return addresses.length > 0 && addresses.every(address => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(address))
}
