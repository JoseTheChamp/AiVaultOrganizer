import type { MethodId } from '../../model/methods';
import { type Charter, charterSchema } from '../schema';
import { ace } from './ace';
import { flatCategories } from './flat-categories';
import { johnnyDecimal } from './johnny-decimal';
import { para } from './para';
import { topics } from './topics';
import type { Lang, Preset } from './types';
import { zettelkasten } from './zettelkasten';

export const PRESETS: Record<MethodId, Preset> = {
  para,
  'johnny-decimal': johnnyDecimal,
  ace,
  zettelkasten,
  'flat-categories': flatCategories,
  topics,
};

/** Display order in the setup wizard. */
export const PRESET_ORDER: MethodId[] = ['para', 'ace', 'flat-categories', 'johnny-decimal', 'zettelkasten', 'topics'];

export function presetCharter(id: MethodId, lang: Lang): Charter {
  return charterSchema.parse(PRESETS[id].build(lang));
}

export type { Lang, Preset } from './types';
export { toLang } from './types';
