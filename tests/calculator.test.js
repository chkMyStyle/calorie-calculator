const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CalculationError,
  calculateBmr,
  calculateInitial,
  recalculate,
  prefillAdjustment,
  calculateCaloriesFromMacros,
} = require('../calculator.js');

const profile = { sex: 'male', age: 30, height: 180, weight: 90, targetWeight: 80, activity: 'low', goal: 'lose' };
const adjustment = { currentCalories: 2000, weight: 90, targetWeight: 80, correction: 0 };

test('BMR по формуле Миффлина — Сан Жеора для мужчин и женщин', () => {
  assert.equal(calculateBmr(profile), 1880);
  assert.equal(calculateBmr({ ...profile, sex: 'female' }), 1714);
});

for (const [activity, calories] of Object.entries({ low: 2256, moderate: 2726, high: 3196 })) {
  test(`Коэффициент активности: ${activity}`, () => {
    const result = calculateInitial({ ...profile, activity, goal: 'maintain' });
    assert.equal(result.maintenance, calories);
    assert.equal(result.calories, calories);
  });
}

test('Поддержание использует текущий вес для расчёта белков', () => {
  const result = calculateInitial({ ...profile, goal: 'maintain', targetWeight: '' });
  assert.equal(result.targetWeight, 90);
  assert.equal(result.correction, 0);
  assert.equal(result.protein, 162);
});

test('Дефицит 10% и БЖУ рассчитываются от соответствующих весов и бюджета', () => {
  assert.deepEqual(calculateInitial(profile), {
    bmr: 1880, maintenance: 2256, correction: -10, calories: 2030,
    weight: 90, targetWeight: 80, protein: 144, fat: 63, carbs: 222,
  });
});

for (const [percent, calories] of [[-5, 1900], [-10, 1800], [5, 2100], [10, 2200]]) {
  test(`Корректировка ${percent}%`, () => {
    const result = recalculate({ ...adjustment, correction: String(percent) });
    assert.equal(result.calories, calories);
    assert.equal(result.carbs, Math.round((calories - 144 * 4 - 63 * 9) / 4));
  });
}

test('Дробные значения с запятой принимаются, результат округляется до целых', () => {
  const result = recalculate({ currentCalories: '2000,5', weight: '90,8', targetWeight: '80,4', correction: 0 });
  assert.deepEqual(result, { correction: 0, calories: 2001, protein: 145, fat: 64, carbs: 213 });
});

test('Дефицит применяется до округления калорийности поддержания', () => {
  const result = calculateInitial({ ...profile, age: 31, height: 179, weight: 90.5 });
  assert.equal(result.maintenance, 2249);
  assert.equal(result.calories, 2024);
});

test('Некорректные параметры первого расчёта отклоняются', () => {
  for (const [field, value] of [
    ['sex', ''], ['age', '17'], ['age', '23.5'], ['age', 121], ['height', -1],
    ['height', '1.8'], ['weight', 0], ['weight', '90кг'], ['weight', '1e2'],
    ['weight', 501], ['weight', Infinity], ['activity', 'toString'], ['goal', 'gain'],
    ['targetWeight', ''], ['targetWeight', 90], ['targetWeight', 95],
  ]) {
    assert.throws(() => calculateInitial({ ...profile, [field]: value }), { name: 'CalculationError', field });
  }
});

test('Некорректные параметры перерасчёта отклоняются', () => {
  for (const [field, value] of [
    ['currentCalories', ''], ['currentCalories', 0], ['currentCalories', 15001],
    ['weight', -90], ['targetWeight', NaN], ['correction', 15], ['correction', ''],
  ]) {
    assert.throws(() => recalculate({ ...adjustment, [field]: value }), { name: 'CalculationError', field });
  }
});

test('БЖУ блокируются, если белки и жиры превышают бюджет до или после округления', () => {
  assert.throws(() => recalculate({ ...adjustment, currentCalories: 1100 }), /не помещаются/);
  assert.throws(() => recalculate({
    currentCalories: 1142, weight: 90.8, targetWeight: 79, correction: 0,
  }), /не помещаются/);
});

test('При точном совпадении энергии белков и жиров с бюджетом углеводов 0 г', () => {
  const result = recalculate({ ...adjustment, currentCalories: 1143 });
  assert.equal(result.carbs, 0);
});

test('Дефицит блокируется при низком текущем или целевом ИМТ', () => {
  assert.throws(() => calculateInitial({ ...profile, weight: 59, targetWeight: 58 }), /ИМТ ниже 18,5/);
  assert.throws(() => calculateInitial({ ...profile, targetWeight: 59 }), /ИМТ ниже 18,5/);
});

test('Очень низкая калорийность блокируется в обоих режимах', () => {
  assert.throws(() => calculateInitial({
    ...profile, sex: 'female', age: 75, height: 150, weight: 42, goal: 'maintain',
  }), /меньше 1 000/);
  assert.throws(() => recalculate({ ...adjustment, currentCalories: 1100, correction: -10 }), /меньше 1 000/);
  assert.throws(() => recalculate({ ...adjustment, currentCalories: 999.9 }), CalculationError);
});

test('Первичный расчёт передаёт веса и калории без автоматической корректировки', () => {
  for (const goal of ['lose', 'maintain']) {
    const initial = calculateInitial({ ...profile, goal });
    const prefill = prefillAdjustment(initial);
    assert.deepEqual(prefill, {
      currentCalories: initial.calories, weight: 90, targetWeight: goal === 'lose' ? 80 : 90, correction: 0,
    });
    const result = recalculate(prefill);
    for (const key of ['calories', 'protein', 'fat', 'carbs']) assert.equal(result[key], initial[key]);
  }
});

test('Перерасчёт работает с введёнными вручную данными без первичного расчёта', () => {
  assert.deepEqual(recalculate(adjustment), {
    correction: 0, calories: 2000, protein: 144, fat: 63, carbs: 214,
  });
});

test('Калорийность по БЖУ использует коэффициенты 4, 9 и 4 ккал/г', () => {
  assert.equal(calculateCaloriesFromMacros({ protein: 30, fat: 20, carbs: 50 }), 500);
});

test('Расчёт по БЖУ принимает нули, запятую и точку', () => {
  assert.equal(calculateCaloriesFromMacros({ protein: '0', fat: '2,5', carbs: '10.25' }), 63.5);
  assert.equal(calculateCaloriesFromMacros({ protein: 0, fat: 0, carbs: 0 }), 0);
});

test('Расчёт по БЖУ отклоняет пустые, отрицательные и некорректные значения', () => {
  const macros = { protein: 30, fat: 20, carbs: 50 };
  for (const [field, value] of [['protein', ''], ['fat', '-1'], ['carbs', '10 г'], ['carbs', 10001]]) {
    assert.throws(() => calculateCaloriesFromMacros({ ...macros, [field]: value }), {
      name: 'CalculationError', field,
    });
  }
});
