/** Справочники дневника. Используются сервером, EJS-шаблонами и браузером. */

export const painLocations = [
  { value: 'chest_wall', label: 'Область операции' },
  { value: 'axilla', label: 'Подмышечная впадина' },
  { value: 'shoulder', label: 'Плечо' },
  { value: 'upper_arm', label: 'Верхняя часть руки' },
  { value: 'forearm', label: 'Предплечье' },
  { value: 'chest', label: 'Грудная клетка' },
  { value: 'neck', label: 'Шея и надплечье' },
];

export const painCharacters = [
  { value: 'burning', label: 'Жгучая' },
  { value: 'shooting', label: 'Стреляющая' },
  { value: 'aching', label: 'Ноющая' },
  { value: 'pulsing', label: 'Пульсирующая' },
  { value: 'lancinating', label: 'Простреливающая' },
  { value: 'numbness', label: 'Онемение' },
  { value: 'allodynia', label: 'Боль от прикосновения' },
];

export const nightWake = [
  { value: 'none', label: 'Не просыпалась' },
  { value: 'once', label: '1 раз' },
  { value: 'two_three', label: '2–3 раза' },
  { value: 'more', label: 'Больше 3 раз' },
];

export const symptomScale = [
  { value: 0, label: 'Нет' },
  { value: 1, label: 'Слабо' },
  { value: 2, label: 'Умеренно' },
  { value: 3, label: 'Сильно' },
];

export const mobilityScale = [
  { value: 0, label: 'Нет ограничений' },
  { value: 1, label: 'Легкое' },
  { value: 2, label: 'Умеренное' },
  { value: 3, label: 'Выраженное' },
];

export const edemaScale = [
  { value: 0, label: 'Нет' },
  { value: 1, label: 'Легкий' },
  { value: 2, label: 'Умеренный' },
  { value: 3, label: 'Выраженный' },
];

export const medOptions = [
  { value: 'none', label: 'Не принимала' },
  { value: 'paracetamol', label: 'Парацетамол' },
  { value: 'nsaid', label: 'НПВС (ибупрофен, диклофенак)' },
  { value: 'tramadol', label: 'Трамадол' },
  { value: 'pregabalin', label: 'Прегабалин' },
  { value: 'gabapentin', label: 'Габапентин' },
  { value: 'amitriptyline', label: 'Амитриптилин' },
  { value: 'duloxetine', label: 'Дулоксетин' },
  { value: 'other', label: 'Другое' },
];

export const sideEffectOptions = [
  { value: 'none', label: 'Не было' },
  { value: 'dizziness', label: 'Головокружение' },
  { value: 'drowsiness', label: 'Сонливость' },
  { value: 'nausea', label: 'Тошнота' },
  { value: 'swelling', label: 'Отёки' },
  { value: 'dry_mouth', label: 'Сухость во рту' },
  { value: 'other', label: 'Другое' },
];

export const adherenceOptions = [
  { value: 'full', label: 'Принимала полностью' },
  { value: 'partial', label: 'Принимала частично' },
  { value: 'none', label: 'Не принимала' },
  { value: 'not_prescribed', label: 'Не назначено' },
];

export const painLabels = {
  0: 'Нет боли',
  1: 'Едва заметная',
  2: 'Слабая',
  3: 'Слабая',
  4: 'Умеренная',
  5: 'Умеренная',
  6: 'Заметная',
  7: 'Сильная',
  8: 'Сильная',
  9: 'Очень сильная',
  10: 'Невыносимая',
};

export function labelOf(list, value) {
  return list.find((item) => item.value === value)?.label ?? String(value ?? '');
}

export function labelsOf(list, values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => labelOf(list, value));
}
