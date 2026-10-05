/** Carta del local: precio por botella (reservados) y de los refrescos. */
export interface MenuItem {
  name: string;
  price: number;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const items = (price: number, names: string[]): MenuItem[] => names.map((name) => ({ name, price }));

export const BOTTLE_GROUPS: MenuGroup[] = [
  {
    label: 'Ginebra',
    items: [
      { name: 'Bombay Sapphire', price: 100 },
      { name: 'Bowtie', price: 100 },
      { name: 'Brockmans', price: 110 },
      { name: 'Bulldog', price: 100 },
      { name: 'G’Vine', price: 130 },
      ...items(100, ['Larios', 'Larios 12', 'Larios Rosé', 'Martin Miller']),
      ...items(100, ['Puerto de Indias Melón', 'Puerto de Indias Exótica', 'Puerto de Indias Fresa', 'Puerto de Indias Limón']),
      ...items(100, ['Rives Exótica', 'Roku', 'Tanqueray', 'Gin Master', 'Gin Master Green', 'Gin Master Pink']),
      ...items(100, ['Beefeater', 'Beefeater Black', 'Beefeater Pink', "Seagram's"]),
      { name: 'Monkey 47', price: 140 },
      { name: 'Malfy Gin', price: 100 },
    ],
  },
  {
    label: 'Ron',
    items: [
      ...items(100, ['Bacardí 11', 'Bacardí Limón', 'Cacique']),
      { name: 'Cacique 500', price: 110 },
      ...items(100, ['Legendario', 'Legendario Oro', 'Santa Teresa Gran Reserva', 'Barceló']),
      { name: 'Barceló Imperial', price: 110 },
      ...items(100, ['Havana 7', 'Havana 3']),
    ],
  },
  {
    label: 'Vodka',
    items: [
      ...items(120, ['AU Vodka Chicle', 'AU Vodka Normal', 'AU Vodka Black Grape', 'AU Vodka Fruit Punch', 'AU Vodka Sandía', 'AU Vodka Blueberry']),
      ...items(140, ['Belvedere', 'Cîroc Frutos Rojos', 'Cîroc Manzana', 'Cîroc Melocotón']),
      { name: 'Eristoff Black', price: 90 },
      { name: 'Grey Goose', price: 140 },
      ...items(100, ['Legendario Vodka', 'Vodka Caramelo Rives', 'Absolut']),
      { name: 'Belvedere 1,75 L', price: 350 },
      { name: 'Belvedere 3 L', price: 600 },
    ],
  },
  {
    label: 'Whisky',
    items: [
      { name: 'Black Label', price: 110 },
      { name: "Dewar's 12", price: 110 },
      { name: 'DYC 8', price: 100 },
      { name: 'Hibiki Japanese', price: 280 },
      ...items(100, ["Jack Daniel's", "Jack Daniel's Apple", "Jack Daniel's Fire", 'J&B']),
      { name: 'Macallan 12 Double Cask', price: 200 },
      ...items(100, ['Red Label', 'White Label']),
      { name: 'Monkey Shoulder', price: 110 },
      ...items(100, ["Ballantine's 10", "Ballantine's", 'Jameson', 'Four Roses']),
      { name: 'Chivas Mizunara', price: 140 },
      { name: 'Chivas 15', price: 130 },
      { name: 'Chivas Regal', price: 110 },
      { name: 'Chivas Regal 18', price: 220 },
      { name: 'Blue Label', price: 800 },
    ],
  },
  {
    label: 'Champagne',
    items: [
      { name: 'Moët Brut Impérial', price: 140 },
      { name: 'Moët Ice', price: 150 },
      { name: 'Moët N.I.R.', price: 160 },
      { name: 'Belaire Rosé', price: 120 },
      { name: 'Belaire Rosé 1,5 L', price: 240 },
      ...items(130, ['Belaire Luxe Fantôme', 'Belaire Bleu Fantôme', 'Belaire Gold Fantôme']),
    ],
  },
  {
    label: 'Specials',
    items: [
      ...items(100, ['Baileys', 'Jägermeister', 'Jalisco Gold', 'Licor 43']),
      { name: 'Martini Sin Alcohol Vibrante', price: 40 },
      ...items(100, ['Tequila Spicy Güey', 'Tequila Mango Mex', 'Tequila Maracuyá Mex', 'Tequila Melón Mex', 'Tequila Fresa Mex']),
      ...items(40, ['Vermut Martini Rosso', 'Vermut Martini Fiero', 'Vermut Martini Sin Alcohol', 'Vermut Martini Bianco']),
      ...items(100, ['Malavita', 'Fireball', 'Tequila Rooster Rojo Blanco', 'Malibu', 'Altos Blanco Tequila', 'Patrón']),
    ],
  },
];

/** Refrescos de los reservados: van incluidos con la botella; sólo el Monster suma 1 € cada uno */
export const MIXER_GROUPS: MenuGroup[] = [
  { label: 'Refrescos', items: items(0, ['Coca-Cola', 'Coca-Cola Zero', 'Fanta Naranja', 'Fanta Limón', 'Sprite', 'Tónica', 'Ginger Ale']) },
  { label: 'Bebidas energéticas', items: [...items(1, ['Monster', 'Monster Ultra']), ...items(0, ['Red Bull', 'Red Bull Sin Azúcar'])] },
  { label: 'Zumos y agua', items: items(0, ['Zumo de naranja', 'Zumo de piña', 'Agua', 'Agua con gas']) },
];

const PRICES = new Map([...BOTTLE_GROUPS, ...MIXER_GROUPS].flatMap((g) => g.items).map((i) => [i.name, i.price]));

/** Precio de la carta de una botella o refresco (undefined si no está en la carta) */
export const menuPrice = (name: string) => PRICES.get(name);
