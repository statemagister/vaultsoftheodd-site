#!/bin/bash
# gygax-v2-rebuild.sh — rebuild the whole corpus from held artefacts.
#
#   scripts/gygax-v2-rebuild.sh <packages-dir> <out-dir>
#
# <packages-dir> holds the evidence package ZIPs and the v1 root archive, named as
# below. <out-dir> receives the rebuilt SQLite and a complete staged evidence tree.
# Nothing outside those two paths and this repository is used.
#
# This is the reconstruction path the preservation manifest describes, in executable
# form. It was verified on 5 September 2026 to reproduce the canonical corpus exactly:
# all ten tables identical on id-independent content, plus a byte-identical 2,106-file
# evidence tree. Prose alone was not enough — running it is what surfaced the four
# details below, each of which would have broken a reconstruction.
#
# THE FOUR NON-OBVIOUS DETAILS, all encoded here rather than left to be rediscovered:
#
#   1. Sacco must use the MANIFESTFIXED package, NOT the one named FINAL. The
#      FINAL-labelled archive is round three of four and carries no clip boxes; the
#      ingester rejects it with 220 problems. Filename labels are not authority.
#   2. Parts VI and VII need --force. Both trip the date-window duplicate guard for real
#      reasons: the Part V/VI boundary runs backwards in displayed time, and Parts VII
#      and VIII genuinely overlap. Documented in their ingest commits and in
#      segment_boundary_discontinuity annotations inside the corpus.
#   3. White Dwarf #14 needs --page-map. Without it every provenance row reads
#      "pp.23-24" instead of the specific page. The map is committed alongside this
#      script; it was reconstructed by exact pixel matching against the two preserved
#      page images, which placed 16 of 19 cards, with the three stitched composites
#      taken from the ingest commit's own record.
#   4. Two packages nest their payload under an inner directory, so the package path is
#      not the unpack path.
set -eu
PKGS=${1:?usage: gygax-v2-rebuild.sh <packages-dir> <out-dir>}
OUT=${2:?usage: gygax-v2-rebuild.sh <packages-dir> <out-dir>}
REPO=$(cd "$(dirname "$0")/.." && pwd)
N="node --experimental-sqlite"

mkdir -p "$OUT/pkg" "$OUT/evidence"
x() { mkdir -p "$OUT/pkg/$2"; unzip -q -o "$PKGS/$1.zip" -d "$OUT/pkg/$2"; }

x gygaxenworldsearchenginev1                                  v1
x gygaxpdfpostcardsv2stageA                                   stageA
x gygaxenworldstageAreconstructionregularization20260903      stageA_reg
x gygaxenworldstageAquotedquestionregularizationv420260903    stageA_qq
x gygaxenworldstageAattributionreconciliationCORRECTED20260905 stageA_ar
x gygaxdragonsfootcardsbatch01                                df
x gygaxdragonsfootbatch01reconstructionregularization20260903 df_reg
x gygaxdragonsfootbatch01quotedquestionregularization20260903 df_qq
x gygaxwardgreyhawk2evidencecorrectedv3                       ward
x gygaxgamespyinterviewpart1unitcardsv2                       gamespy
x gygaxgamespypart1reconciliation20260903                     gamespy_rec
x gygaxcyclopeatronprovenancev2                               cyclo
x gygaxgamasutra2002interviewevidence                         gamasutra
x gygaxwargamersdigest1974swordssorceryevidencev3             wargamers
x gygaxae15letterevidenceverified20260903                     ae15
x gygaxwhitedwarf14interviewevidenceverifiedcorrected20260904 wd14
x gygax22questionsevidencev2.1corrected20260904               q22
x gygaxoerthjournal12gygaxquestionnairesevidencev2.1corrected20260904 oj12
x gygaxdungeonsitsaccoultimateinterviewevidencev2.1MANIFESTFIXED20260904 sacco
x gygaxenworldpart03COMPLETEevidencev2.1CORRECTED20260904     p03
x gygaxenworldpart04identityreconciliationFLEXOR20260905      p04
x gygaxenworldpart05COMPLETEevidencev220260904                p05
x gygaxenworldpart06COMPLETEevidencev220260905                p06
x gygaxenworldpart07COMPLETEevidencev2.1CORRECTED20260905     p07
x gygaxenworldpart13Aevidencev220260905                       p13a
x gygaxenworldpart13Bevidencev2.1CORRECTED20260905            p13b
x gygaxenworldpart13Cevidencev2.2CORRECTED20260905            p13c

DB="$OUT/rebuilt.sqlite"; EV="$OUT/evidence"; P="$OUT/pkg"
cd "$REPO"
step() { echo; echo "--- $1 ---"; shift; "$@"; }

step "migrate v1 -> v2"         $N scripts/gygax-v2-migrate.mjs "$P/v1/gygax_enworld.sqlite" "$DB"
step "ENWorld Stage A"          $N scripts/gygax-v2-ingest-enworld-cards.mjs "$DB" \
    "$P/stageA/gygax_pdf_post_cards_v2_staging" "$EV" \
    --regularization "$P/stageA_reg" --quoted-questions "$P/stageA_qq" \
    --attribution-reconciliation "$P/stageA_ar/stageA_recon_pkg"
step "Dragonsfoot batch 01"     $N scripts/gygax-v2-ingest-dragonsfoot.mjs "$DB" \
    "$P/df/mnt/data/gygax_dragonsfoot_cards_batch01" "$EV" \
    --regularization "$P/df_reg" --quoted-questions "$P/df_qq"
step "Ward Greyhawk #2"         $N scripts/gygax-v2-ingest-ward-greyhawk2.mjs "$DB" "$P/ward" "$EV"
step "GameSpy Part I"           $N scripts/gygax-v2-ingest-gamespy-part1.mjs "$DB" "$P/gamespy" "$EV" \
    --reconciliation "$P/gamespy_rec"
step "Cyclopeatron"             $N scripts/gygax-v2-ingest-cyclopeatron.mjs "$DB" "$P/cyclo" "$EV"
step "Gamasutra 2002"           $N scripts/gygax-v2-ingest-gamasutra-2002.mjs "$DB" "$P/gamasutra" "$EV"
step "Wargamer's Digest 1974"   $N scripts/gygax-v2-ingest-wargamers-digest-1974.mjs "$DB" "$P/wargamers" "$EV"
step "A&E #15 letter"           $N scripts/gygax-v2-ingest-ae15-letter.mjs "$DB" "$P/ae15" "$EV"
step "White Dwarf #14"          $N scripts/gygax-v2-ingest-white-dwarf-14.mjs "$DB" "$P/wd14" "$EV" \
    --page-map "$REPO/scripts/gygax-v2-wd14-pagemap.json"
step "22 Questions"             $N scripts/gygax-v2-ingest-22-questions.mjs "$DB" "$P/q22" "$EV"
step "Oerth Journal #12"        $N scripts/gygax-v2-ingest-oerth-journal-12.mjs "$DB" "$P/oj12" "$EV"
step "Sacco Ultimate Interview" $N scripts/gygax-v2-ingest-sacco-interview.mjs "$DB" "$P/sacco" "$EV"
step "ENWorld Part III"         $N scripts/gygax-v2-ingest-enworld-part03.mjs "$DB" "$P/p03" "$EV"
step "ENWorld Part IV"          $N scripts/gygax-v2-ingest-enworld-part04.mjs "$DB" "$P/p04" "$EV"
step "ENWorld Part V"           $N scripts/gygax-v2-ingest-enworld-part05.mjs "$DB" "$P/p05" "$EV"
step "ENWorld Part VI"          $N scripts/gygax-v2-ingest-enworld-part06.mjs "$DB" "$P/p06" "$EV" --force
step "ENWorld Part VII"         $N scripts/gygax-v2-ingest-enworld-part07.mjs "$DB" "$P/p07" "$EV" --force
step "ENWorld Part XIII-A"      $N scripts/gygax-v2-ingest-enworld-part13a.mjs "$DB" "$P/p13a" "$EV"
step "ENWorld Part XIII-B"      $N scripts/gygax-v2-ingest-enworld-part13b.mjs "$DB" "$P/p13b" "$EV"
step "ENWorld Part XIII-C"      $N scripts/gygax-v2-ingest-enworld-part13c.mjs "$DB" "$P/p13c" "$EV"

echo
echo "rebuild complete: $DB"
echo "verify with: scripts/gygax-v2-conformance-audit.mjs and build-gygax-v2.mjs --strict"
