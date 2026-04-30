import bwipjs from 'bwip-js';

type RawMatrix = {pixs: number[]; pixx: number; pixy: number};

/**
 * Encode `text` as an Aztec symbol and return it as a string of Unicode
 * half-block characters (▀ ▄ █) — two source rows per terminal row, so the
 * output is roughly square in a typical monospace font.
 *
 * `eclevel` 23 lets bwip-js pick the smallest layer count that fits a typical
 * BCBP boarding pass at ~30% ECC, matching what airline apps emit.
 */
export function aztecToHalfBlocks(text: string, eclevel = 23): string {
	// `eclevel` is barcode-specific and not in bwip-js's typed options; pass it
	// via the string-form overload (key=value, space-separated) instead.
	const symbols = bwipjs.raw('azteccode', text, `eclevel=${eclevel}`);
	const s = symbols[0] as RawMatrix | undefined;
	if (!s || !('pixs' in s)) {
		throw new Error('bwip-js did not return a pixel matrix for azteccode');
	}
	const {pixs, pixx, pixy} = s;
	const lines: string[] = [];
	for (let y = 0; y < pixy; y += 2) {
		let row = '';
		for (let x = 0; x < pixx; x++) {
			const top = pixs[y * pixx + x];
			const bot = y + 1 < pixy ? pixs[(y + 1) * pixx + x] : 0;
			if (top && bot) row += '█';
			else if (top) row += '▀';
			else if (bot) row += '▄';
			else row += ' ';
		}
		lines.push(row);
	}
	return lines.join('\n');
}
