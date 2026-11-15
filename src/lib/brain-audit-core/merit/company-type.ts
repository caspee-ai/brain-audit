import type { MethodCatalog, MethodElement } from '../method/types';
import { COMPANY_TYPES, type CompanyType } from '../pack/vocab';
import type { MeritSubject } from './types';

export type MeritCompanyProfile = {
	company_type: CompanyType;
	subject: MeritSubject;
	module: string | null;
};

export function meritProfileOf(
	catalog: Pick<MethodCatalog, 'company_types' | 'modules'>,
	companyType: CompanyType
): MeritCompanyProfile {
	if (!(COMPANY_TYPES as readonly string[]).includes(companyType))
		throw new Error(`unknown company type ${companyType}`);
	const type = Object.prototype.hasOwnProperty.call(catalog.company_types, companyType)
		? catalog.company_types[companyType]
		: undefined;
	if (!type) throw new Error(`catalog has no company type ${companyType}`);
	if (type.module !== null && !catalog.modules.some((m) => m.id === type.module))
		throw new Error(`catalog has no module ${type.module}`);
	return { company_type: companyType, subject: type.subject, module: type.module };
}

export function meritElementsFor(
	catalog: Pick<MethodCatalog, 'company_types' | 'modules' | 'elements'>,
	companyType: CompanyType
): MethodElement[] {
	const profile = meritProfileOf(catalog, companyType);
	const module = profile.module ? catalog.modules.find((m) => m.id === profile.module) : undefined;
	return [...catalog.elements, ...(module?.elements ?? [])];
}
