const CalorieCalculator = (() => {
  const activityFactors = Object.freeze({ low: 1.20, moderate: 1.45, high: 1.70 });
  const corrections = Object.freeze([0, -5, -10, 5, 10]);
  const minimumCalories = 1000;
  const energyPerGram = { protein: 4, fat: 9, carbs: 4 };

  class CalculationError extends Error {
    constructor(message, field) {
      super(message);
      this.name = 'CalculationError';
      this.field = field;
    }
  }

  function readNumber(value, field, min, max, message, integer = false) {
    const text = String(value ?? '').trim();
    const number = /^\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
      throw new CalculationError(message, field);
    }
    return number;
  }

  function readWeight(value, field) {
    const label = field === 'weight' ? 'текущий' : 'целевой';
    return readNumber(value, field, 20, 500, `Укажите ${label} вес от 20 до 500 кг.`);
  }

  function readProfile({ sex, age, height, weight }) {
    if (sex !== 'male' && sex !== 'female') {
      throw new CalculationError('Выберите пол для расчётной формулы.', 'sex');
    }
    return {
      sex,
      age: readNumber(age, 'age', 18, 120, 'Укажите возраст от 18 до 120 полных лет.', true),
      height: readNumber(height, 'height', 100, 250, 'Укажите рост от 100 до 250 см.'),
      weight: readWeight(weight, 'weight'),
    };
  }

  function bmrFromProfile({ sex, age, height, weight }) {
    return 10 * weight + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161);
  }

  function calculateBmr(input) {
    return bmrFromProfile(readProfile(input));
  }

  function calculateCaloriesFromMacros({ protein, fat, carbs }) {
    const proteinGrams = readNumber(protein, 'protein', 0, 10000, 'Укажите количество белков от 0 до 10 000 г.');
    const fatGrams = readNumber(fat, 'fat', 0, 10000, 'Укажите количество жиров от 0 до 10 000 г.');
    const carbGrams = readNumber(carbs, 'carbs', 0, 10000, 'Укажите количество углеводов от 0 до 10 000 г.');
    return proteinGrams * energyPerGram.protein + fatGrams * energyPerGram.fat + carbGrams * energyPerGram.carbs;
  }

  function calculateMacros(calories, weight, targetWeight) {
    const rawProtein = targetWeight * 1.8;
    const rawFat = weight * 0.7;
    const protein = Math.round(rawProtein);
    const fat = Math.round(rawFat);
    const remaining = calories - rawProtein * energyPerGram.protein - rawFat * energyPerGram.fat;
    if (remaining < -1e-9 || protein * energyPerGram.protein + fat * energyPerGram.fat > calories) {
      throw new CalculationError('Белки и жиры не помещаются в эту калорийность. Проверьте вес и выбранную цель или корректировку.');
    }
    const carbs = Math.round(Math.max(0, remaining) / energyPerGram.carbs);
    return { protein, fat, carbs };
  }

  function calculateInitial(input) {
    const { activity, goal } = input;
    const profile = readProfile(input);
    if (!Object.prototype.hasOwnProperty.call(activityFactors, activity)) {
      throw new CalculationError('Выберите уровень активности.', 'activity');
    }
    if (goal !== 'lose' && goal !== 'maintain') {
      throw new CalculationError('Выберите цель расчёта.', 'goal');
    }
    const { weight, height } = profile;
    const targetWeight = goal === 'lose' ? readWeight(input.targetWeight, 'targetWeight') : weight;
    if (goal === 'lose') {
      if (targetWeight >= weight) {
        throw new CalculationError('Для похудения целевой вес должен быть ниже текущего.', 'targetWeight');
      }
      const metersSquared = (height / 100) ** 2;
      if (weight / metersSquared < 18.5 || targetWeight / metersSquared < 18.5) {
        throw new CalculationError('При текущем или целевом ИМТ ниже 18,5 для похудения нужна индивидуальная оценка питания.');
      }
    }
    const bmr = bmrFromProfile(profile);
    const maintenance = bmr * activityFactors[activity];
    const correction = goal === 'lose' ? -10 : 0;
    const { calories, ...macros } = calculateBudget(maintenance, correction, weight, targetWeight);
    return { bmr, maintenance: Math.round(maintenance), correction, calories, weight, targetWeight, ...macros };
  }

  function calculateBudget(base, correction, weight, targetWeight) {
    const budget = base * (1 + correction / 100);
    if (budget < minimumCalories) {
      throw new CalculationError('Получилось меньше 1 000 ккал в сутки. Такой расчёт требует индивидуальной оценки питания.');
    }
    const calories = Math.round(budget);
    return { calories, ...calculateMacros(calories, weight, targetWeight) };
  }

  function recalculate({ currentCalories, weight, targetWeight, correction }) {
    const base = readNumber(currentCalories, 'currentCalories', 1, 15000, 'Укажите текущую калорийность от 1 до 15 000 ккал.');
    const currentKg = readWeight(weight, 'weight');
    const targetKg = readWeight(targetWeight, 'targetWeight');
    const percent = Number(correction);
    if (String(correction ?? '').trim() === '' || !corrections.includes(percent)) {
      throw new CalculationError('Выберите одну из доступных корректировок.', 'correction');
    }
    return { correction: percent, ...calculateBudget(base, percent, currentKg, targetKg) };
  }

  function prefillAdjustment({ calories, weight, targetWeight }) {
    return { currentCalories: calories, weight, targetWeight, correction: 0 };
  }

  return { CalculationError, calculateBmr, calculateInitial, recalculate, prefillAdjustment, calculateCaloriesFromMacros };
})();

if (typeof module === 'object' && module.exports) {
  module.exports = CalorieCalculator;
}
