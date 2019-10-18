import Component from '@ember/component';
import { task } from 'ember-concurrency';
import { inject as service } from '@ember/service';
import { or, reads } from '@ember/object/computed';
import { computed } from '@ember/object';
import config from 'travis/config/environment';

export default Component.extend({
  stripe: service('stripe'),
  store: service('store'),
  accounts: service('accounts'),
  flashes: service('flashes'),
  raven: service('raven'),
  metrics: service('metrics'),
  api: service('api'),

  account: null,
  stripeElement: null,
  stripeLoading: false,
  newSubscription: null,
  coupon: null,
  options: config.stripeOptions,

  firstName: reads('newSubscription.billingInfo.firstName'),
  lastName: reads('newSubscription.billingInfo.lastName'),
  company: reads('newSubscription.billingInfo.company'),
  email: reads('newSubscription.billingInfo.billingEmail'),
  address: reads('newSubscription.billingInfo.address'),
  city: reads('newSubscription.billingInfo.city'),
  country: reads('newSubscription.billingInfo.country'),
  isLoading: or('createSubscription.isRunning', 'accounts.fetchSubscriptions.isRunning'),

  isValidCoupon: reads('coupon.valid'),
  isInvalidCoupon: false,

  createSubscription: task(function* () {
    this.metrics.trackEvent({
      action: 'Pay Button Clicked',
      category: 'Subscription',
    });
    const { stripeElement, account, newSubscription, selectedPlan } = this;
    try {
      const {
        token: { id, card },
        error
      } = yield this.stripe.createStripeToken.perform(stripeElement);
      if (!error) {
        const organizationId = account.type === 'organization' ? +(account.id) : null;
        newSubscription.creditCardInfo.setProperties({
          token: id,
          lastDigits: card.last4
        });
        newSubscription.setProperties({ organizationId, plan: selectedPlan });
        const { clientSecret } = yield newSubscription.save();
        this.metrics.trackEvent({ button: 'pay-button' });
        yield this.stripe.handleStripePayment.perform(clientSecret);
      }
    } catch (error) {
      this.handleError();
    }
  }).drop(),

  // amount_off and price are in cents
  discountedPrice: computed('coupon.{amountOff,percentOff}', 'selectedPlan.price', function () {
    const price = Math.floor(this.selectedPlan.price / 100);
    if (this.coupon && this.coupon.amountOff) {
      const { amountOff } = this.coupon;
      const discountedPrice = price - Math.floor(amountOff / 100);
      return `$${discountedPrice}`;
    } else if (this.coupon && this.coupon.percentageOff) {
      const { percentageOff } = this.coupon;
      const discountedPrice = price - (price * percentageOff) / 100;
      return `$${discountedPrice.toFixed(2)}`;
    } {
      return `$${price}`;
    }
  }),

  validateCoupon: task(function* () {
    try {
      const coupon = yield this.store.findRecord('coupon', this.couponId, {
        reload: true,
      });
      this.set('coupon', coupon);
    } catch (error) {
      const containsCouponErrors = error && error.errors.length > 0;
      if (containsCouponErrors) {
        const couponError = error.errors[0];
        const isInvalidCoupon = couponError.detail === `No such coupon: ${this.couponId}`;
        this.set('isInvalidCoupon', isInvalidCoupon);
      }
    }
  }).drop(),

  handleError() {
    let message = 'An error occurred when creating your subscription. Please try again.';
    const subscriptionErrors = this.newSubscription.errors;
    if (subscriptionErrors && subscriptionErrors.get('validationErrors').length > 0) {
      const validationError = subscriptionErrors.get('validationErrors')[0];
      message = validationError.message;
    }
    this.flashes.error(message);
  },

  actions: {
    complete(stripeElement) {
      this.set('stripeElement', stripeElement);
    },
  }
});
