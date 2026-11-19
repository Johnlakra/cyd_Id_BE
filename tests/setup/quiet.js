// Schema setup logs a lot; keep test output readable. console.error stays visible.
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
