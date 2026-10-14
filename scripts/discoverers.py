# Discoverers as the app shows them (James, 2026-10-14): initials spaced the usual way,
# "G. T. Seaborg", and the dataset's misspellings and mix-ups put right. gen-elements.py runs
# the dataset through tidy(); run this file on src/data/elements.json to apply it in place:
#
#   python3 scripts/discoverers.py src/data/elements.json
import re

# Names the dataset gets wrong, by atomic number.
FIX = {
    2: 'Sir William Ramsay, Nils Langlet, P. T. Cleve',
    4: 'Friedrich Wöhler, A. A. Bussy',
    8: 'Joseph Priestley, Carl Wilhelm Scheele',
    10: 'Sir William Ramsay, M. W. Travers',
    11: 'Sir Humphry Davy', 12: 'Sir Humphry Davy', 19: 'Sir Humphry Davy', 20: 'Sir Humphry Davy', 56: 'Sir Humphry Davy',
    18: 'Sir William Ramsay, Lord Rayleigh',
    25: 'Johan Gahn',
    27: 'Georg Brandt',
    36: 'Sir William Ramsay, M. W. Travers',
    37: 'R. Bunsen, G. Kirchhoff',
    43: 'Carlo Perrier, Emilio Segrè',
    48: 'Friedrich Stromeyer',
    54: 'Sir William Ramsay, M. W. Travers',
    55: 'Gustav Kirchhoff, Robert Bunsen',
    59: 'C. F. Auer von Welsbach', 60: 'C. F. Auer von Welsbach',
    76: 'Smithson Tennant',
    77: 'S. Tennant, A. F. Fourcroy, L. N. Vauquelin, H. V. Collet-Descotils',
    85: 'D. R. Corson, K. R. MacKenzie, E. Segrè',
    86: 'Friedrich Ernst Dorn',
    87: 'Marguerite Perey',
    91: 'Frederick Soddy, John Cranston, Otto Hahn, Lise Meitner',
    94: 'G. T. Seaborg, J. W. Kennedy, E. M. McMillan, A. C. Wahl',
    97: 'G. T. Seaborg, S. G. Thompson, A. Ghiorso',
    98: 'G. T. Seaborg, S. G. Thompson, A. Ghiorso, K. Street Jr.',
    99: 'Argonne, Los Alamos and UC Berkeley', 100: 'Argonne, Los Alamos and UC Berkeley',
    101: 'A. Ghiorso, B. G. Harvey, G. R. Choppin, S. G. Thompson, G. T. Seaborg',
    104: 'A. Ghiorso and others', 105: 'A. Ghiorso and others',
    106: 'Joint Institute for Nuclear Research and UC Berkeley',
    107: 'GSI Helmholtz Centre for Heavy Ion Research', 108: 'GSI Helmholtz Centre for Heavy Ion Research',
    109: 'GSI Helmholtz Centre for Heavy Ion Research', 110: 'GSI Helmholtz Centre for Heavy Ion Research',
    111: 'GSI Helmholtz Centre for Heavy Ion Research',
    117: 'Joint Institute for Nuclear Research and Oak Ridge National Laboratory',
}


def tidy(z, who):
    if not isinstance(who, str):
        return who
    who = FIX.get(z, who)
    who = re.sub(r'\b([A-Z]\.)(?=[A-Z])', r'\1 ', who)  # "A.B.Name" -> "A. B. Name"
    who = re.sub(r'\s*;\s*', ', ', who)
    return re.sub(r'(?<!Jr)(?<!\b[A-Z])\.$', '', who.strip())  # "Known to the ancients."


if __name__ == '__main__':
    import json, sys
    for path in sys.argv[1:]:
        raw = open(path, encoding='utf-8').read()
        data = json.loads(raw)
        for e in data:
            e['who'] = tidy(e['z'], e['who'])
        compact = '\n' not in raw.strip()
        json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':') if compact else None, indent=None if compact else 0)
