function disableComponents(container) {
    for (const component of container.components) {
        if (component?.components) {
            for (const button of component.components) {
                button.data.disabled = true;
            }
        }
    }

    return container;
}

module.exports = disableComponents;