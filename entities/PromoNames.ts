export interface Promo_ENA_INSP {
  name: string | undefined;
  formattedPeriod: string;
  promoType: "ENA" | "INSP";
  onJORF: boolean;
  fullStr: string;
}

function promoToFullStr(promoInfo: {
  name: string | undefined;
  formattedPeriod: string;
}) {
  return promoInfo.name
    ? `${promoInfo.name} (${promoInfo.formattedPeriod})`
    : promoInfo.formattedPeriod;
}

// INSP promotions
// From most recent to oldest
export const ListPromos_INSP_available = [
  {
    name: undefined,
    formattedPeriod: "2025-2027",
  },
  {
    name: "Paul-Émile Victor",
    formattedPeriod: "2024-2026",
  },
  {
    name: "Joséphine Baker",
    formattedPeriod: "2023-2024",
  },
].map((i) => {
  return {
    name: i.name,
    formattedPeriod: i.formattedPeriod,
    promoType: "INSP",
    onJORF: true,
    fullStr: promoToFullStr(i),
  } as Promo_ENA_INSP;
});

// ENA promotions available on JORF
// From most recent to oldest
export const ListPromos_ENA_available = [
  {
    name: "Guillaume Apollinaire",
    formattedPeriod: "2022-2023",
  },
  {
    name: "Germaine Tillion",
    formattedPeriod: "2021-2022",
  },
  {
    name: "Aimé Césaire",
    formattedPeriod: "2020-2021",
  },
  {
    name: "Hannah Arendt",
    formattedPeriod: "2019-2020",
  },
  {
    name: "Molière",
    formattedPeriod: "2018-2019",
  },
  {
    name: "Georges Clemenceau",
    formattedPeriod: "2017-2018",
  },
  {
    name: "Louise Weiss",
    formattedPeriod: "2016-2017",
  },
  {
    name: "George Orwell",
    formattedPeriod: "2015-2016",
  },
  {
    name: "Winston Churchill",
    formattedPeriod: "2014-2015",
  },
  {
    name: "Jean de La Fontaine",
    formattedPeriod: "2013-2014",
  },
  {
    name: "Jean Zay",
    formattedPeriod: "2012-2013",
  },
  {
    name: "Marie Curie",
    formattedPeriod: "2011-2012",
  },
  {
    name: "Jean-Jacques Rousseau",
    formattedPeriod: "2010-2011",
  },
  {
    name: "Robert Badinter",
    formattedPeriod: "2009-2011",
  },
  {
    name: "Émile Zola",
    formattedPeriod: "2008-2010",
  },
  {
    name: "Willy Brandt",
    formattedPeriod: "2007-2009",
  },
  {
    name: "Aristide Briand",
    formattedPeriod: "2006-2008",
  },
  {
    name: "République",
    formattedPeriod: "2005-2007",
  },
  {
    name: "Simone Veil",
    formattedPeriod: "2004-2006",
  },
  {
    name: "Romain Gary",
    formattedPeriod: "2003-2005",
  },
  {
    name: "Léopold Sédar Senghor",
    formattedPeriod: "2002-2004",
  },
  {
    name: "René Cassin",
    formattedPeriod: "2001-2003",
  },
  {
    name: "Copernic",
    formattedPeriod: "2000-2002",
  },
  {
    name: "Nelson Mandela",
    formattedPeriod: "1999-2001",
  },
  {
    name: "Averroès",
    formattedPeriod: "1998-2000",
  },
  {
    name: "Cyrano de Bergerac",
    formattedPeriod: "1997-1999",
  },
  {
    name: "Valmy",
    formattedPeriod: "1996-1998",
  },
  {
    name: "Marc Bloch",
    formattedPeriod: "1995-1997",
  },
  {
    name: "Victor Schoelcher",
    formattedPeriod: "1994-1996",
  },
  {
    name: "René Char",
    formattedPeriod: "1993-1995",
  },
  {
    name: "Antoin de Saint Exupéry",
    formattedPeriod: "1992-1994",
  },
  {
    name: "Léon Gambetta",
    formattedPeriod: "1991-1993",
  },
  {
    name: "Condorcet",
    formattedPeriod: "1990-1992",
  },
].map((i) => {
  return {
    name: i.name,
    formattedPeriod: i.formattedPeriod,
    promoType: "ENA",
    onJORF: true,
    fullStr: promoToFullStr(i),
  } as Promo_ENA_INSP;
});

export const ListPromos_INSP_ENA_available = ListPromos_INSP_available.concat(
  ListPromos_ENA_available,
);

// ENA promotions not available on JORF
// From most recent to oldest

// from here, JORFSearch won't return anything

export const ListPromos_ENA_unavailable = [
  {
    name: "Victor Hugo",
    formattedPeriod: "1989-1991",
  },
  {
    name: "Jean Monnet",
    formattedPeriod: "1988-1990",
  },
  {
    name: "Liberté-Égalité-Fraternité",
    formattedPeriod: "1987-1989",
  },
  {
    name: "Michel de Montaigne",
    formattedPeriod: "1986-1988",
  },
  {
    name: "Fernand Braudel",
    formattedPeriod: "1985-1987",
  },
  {
    name: "Denis Diderot",
    formattedPeriod: "1984-1986",
  },
  {
    name: "Leonard de Vinci",
    formattedPeriod: "1983-1985",
  },
  {
    name: "Louise Michel",
    formattedPeriod: "1982-1984",
  },
  {
    name: "Solidarité",
    formattedPeriod: "1981-1983",
  },
  {
    name: "Henri-François d'Aguesseau",
    formattedPeriod: "1980-1982",
  },
  {
    name: "1979-1981",
    formattedPeriod: "Droits de l'homme",
  },
  {
    name: "Voltaire",
    formattedPeriod: "1978-1980",
  },
  {
    name: "Michel de l'Hospital",
    formattedPeriod: "1977-1979",
  },
  {
    name: "Pierre Mendès France",
    formattedPeriod: "1976-1978",
  },
  {
    name: "André Malraux",
    formattedPeriod: "1975-1977",
  },
  {
    name: "Guernica",
    formattedPeriod: "1974-1976",
  },
  {
    name: "Léon Blum",
    formattedPeriod: "1973-1975",
  },
  {
    name: "Simone Weil",
    formattedPeriod: "1972-1974",
  },
  {
    name: "François Rabelais",
    formattedPeriod: "1971-1973",
  },
  {
    name: "Charles de Gaulle",
    formattedPeriod: "1970-1972",
  },
  {
    name: "Thomas More",
    formattedPeriod: "1969-1971",
  },
  {
    name: "Robespierre",
    formattedPeriod: "1968-1970",
  },
  {
    name: "Jean Jaurès",
    formattedPeriod: "1967-1969",
  },
  {
    name: "Turgot",
    formattedPeriod: "1966-1968",
  },
  {
    name: "Marcel Proust",
    formattedPeriod: "1965-1967",
  },
  {
    name: "Montesquieu",
    formattedPeriod: "1964-1966",
  },
  {
    name: "Stendhal",
    formattedPeriod: "1963-1965",
  },
  {
    name: "Blaise Pascal",
    formattedPeriod: "1962-1964",
  },
  {
    name: "Saint-Just",
    formattedPeriod: "1961-1963",
  },
  {
    name: "Albert Camus",
    formattedPeriod: "1960-1962",
  },
  {
    name: "Lazare Carnot",
    formattedPeriod: "1959-1961",
  },
  {
    name: "Alexis de Tocqueville",
    formattedPeriod: "1958-1960",
  },
  {
    name: "Vauban",
    formattedPeriod: "1957-1959",
  },
  {
    name: "Dix-Huit Juin",
    formattedPeriod: "1956-1958",
  },
  {
    name: "France-Afrique",
    formattedPeriod: "1955-1957",
  },
  {
    name: "Guy Desbos",
    formattedPeriod: "1954-1956",
  },
  {
    name: "Albert Thomas",
    formattedPeriod: "1953-1955",
  },
  {
    name: "Paul Cambon",
    formattedPeriod: "1951-1953",
  },
  {
    name: "Félix Éboué",
    formattedPeriod: "1952-1954",
  },
  {
    name: "Jean Giraudoux",
    formattedPeriod: "1950-1952",
  },
  {
    name: "Europe",
    formattedPeriod: "1949-1951",
  },
  {
    name: "Quarante-Huit",
    formattedPeriod: "1948-1950",
  },
  {
    name: "Jean Moulin",
    formattedPeriod: "1948-1949",
  },
  {
    name: "Nations Unies",
    formattedPeriod: "1947-1949",
  },
  {
    name: "Croix de Lorraine",
    formattedPeriod: "1947-1948",
  },
  {
    name: "Union Française",
    formattedPeriod: "1946-1948",
  },
  {
    name: "France Combattante",
    formattedPeriod: "1946-1947",
  },
].map((i) => {
  return {
    name: i.name,
    formattedPeriod: i.formattedPeriod,
    promoType: "ENA",
    onJORF: false,
    fullStr: promoToFullStr(i),
  } as Promo_ENA_INSP;
});

export const ListPromos_INSP_ENA_all = ListPromos_INSP_ENA_available.concat(
  ListPromos_ENA_unavailable,
);
