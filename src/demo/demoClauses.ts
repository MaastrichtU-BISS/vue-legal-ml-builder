// The demo's Dataset to annotate, and the keyword rule the demo LLM answers with.

export const CLAUSE_LABELS = ['Obligation', 'Permission', 'Prohibition']

export const LEASE_CLAUSES = [
  'The tenant shall pay rent on the first day of each month.',
  'The tenant may keep one small pet with the landlord\'s written consent.',
  'The tenant shall not sublet the premises without the landlord\'s consent.',
  'The landlord must keep the roof and outside walls in good repair.',
  'The tenant may end this lease by giving two months\' notice in writing.',
  'The tenant must not make structural alterations to the premises.',
  'Rent is reviewed every two years by reference to the consumer price index.',
  'The landlord may enter the premises to inspect them after giving 24 hours\' notice.',
  'The tenant shall keep the interior clean and in good condition.',
  'The tenant may not use the premises for any business purpose.',
  'The landlord shall return the deposit within thirty days of the end of the lease.',
  'The tenant may paint the interior walls in neutral colours.',
  'Smoking is not allowed anywhere in the building.',
  'The tenant must report any damage to the landlord without delay.',
  'The tenant shall not cause a nuisance to neighbouring occupiers.',
  'The landlord may increase the rent once a year within the legal limit.',
  'The tenant shall insure their own belongings.',
  'The tenant must not keep flammable materials in the storage room.',
  'The tenant may install a washing machine in the kitchen.',
  'The landlord must provide a working smoke alarm on each floor.',
  'The deposit is held in a government-backed protection scheme.',
  'The tenant shall allow viewings by prospective tenants in the last month of the lease.',
  'The tenant may not change the locks without the landlord\'s consent.',
  'The tenant may use the shared garden between 8:00 and 22:00.',
  'The landlord shall carry out repairs within a reasonable time of being told of them.',
  'The tenant must pay the utility bills for the premises.',
  'The tenant shall not hold parties of more than twenty people.',
  'The tenant may park one car in the allocated space.',
  'This lease is governed by the laws of the Netherlands.',
  'The tenant must return all keys at the end of the lease.',
  'The landlord may not withhold consent to a reasonable request unreasonably.',
  'The tenant shall water the plants in the communal hallway in summer.',
  'The tenant may hang pictures using small nails.',
  'The tenant must not store bicycles in the stairwell.',
  'The landlord shall maintain the central heating system.',
  'Any notice under this lease is given in writing to the address above.',
  'The tenant may assign this lease with the landlord\'s consent.',
  'The tenant shall pay a late fee of 25 euros for rent more than ten days overdue.',
  'The tenant shall not leave rubbish outside the designated bins.',
  'The landlord must give the tenant a copy of the energy performance certificate.',
]

/** The demo LLM's answer: a keyword rule over the text, with a one-line reason.
 * `shall not`, `must not` and `may not` come first, so they are not read as `shall`. */
export function demoSuggestion(text: string, labels: string[]): { label: string; rationale: string } {
  const lower = text.toLowerCase()
  const pick = (label: string, rationale: string) =>
    labels.includes(label) ? { label, rationale } : { label: labels[0], rationale: 'No keyword matched, so the first label.' }
  const negated = lower.match(/\b(shall not|must not|may not)\b/)
  if (negated) return pick('Prohibition', `"${negated[1]}" forbids the act.`)
  const duty = lower.match(/\b(shall|must)\b/)
  if (duty) return pick('Obligation', `"${duty[1]}" imposes a duty.`)
  if (/\bmay\b/.test(lower)) return pick('Permission', '"may" grants a right.')
  return { label: labels[0], rationale: 'No modal verb, so the first label.' }
}
