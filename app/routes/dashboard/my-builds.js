import TravisRoute from 'travis/routes/basic';

export default TravisRoute.extend({
  model(params) {
    return this.store.findAll('build');
  },
});
